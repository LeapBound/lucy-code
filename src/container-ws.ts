import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import { utcNowIso } from "./models.js"

export interface TaskEvent {
  type: string
  taskId: string
  timestamp: string
  payload: Record<string, unknown>
}

interface TaskWebSocket extends WebSocket {
  taskId: string
}

export class ContainerWebSocketServer {
  private readonly wss: WebSocketServer
  private connections = new Map<string, TaskWebSocket>() // taskId -> ws
  private readonly eventHandlers = new Map<string, (event: TaskEvent) => void>()

  constructor(private readonly port: number = 18791) {
    const server = createServer()
    this.wss = new WebSocketServer({ server })
    
    server.listen(port, "0.0.0.0", () => {
      console.log(`Container WebSocket server listening on port ${port}`)
    })

    this.wss.on("connection", (ws: TaskWebSocket, req) => {
      const taskId = new URL(`http://localhost${req.url as string}`).searchParams.get("task") ?? "unknown"
      ws.taskId = taskId
      
      this.connections.set(taskId, ws)
      console.log(`Task ${taskId} connected to WebSocket server`)

      ws.on("message", (data) => {
        try {
          const raw = (data as Buffer).toString()
          const payload = JSON.parse(raw) as Record<string, unknown>
          if (typeof payload.type === "string" && typeof payload.taskId === "string") {
            const event: TaskEvent = {
              type: payload.type,
              taskId: payload.taskId,
              timestamp: typeof payload.timestamp === "string" ? payload.timestamp : utcNowIso(),
              payload: typeof payload.payload === "object" && payload.payload ? payload.payload as Record<string, unknown> : {},
            }
            this.handleEvent(event)
          }
        } catch (error) {
          console.error(`Failed to parse WebSocket message: ${String(error)}`)
        }
      })

      ws.on("close", () => {
        this.connections.delete(taskId)
        console.log(`Task ${taskId} disconnected from WebSocket server`)
      })

      ws.on("error", (error) => {
        console.error(`WebSocket error for task ${taskId}:`, error)
      })
    })
  }

  on(eventType: string, handler: (event: TaskEvent) => void): void {
    this.eventHandlers.set(eventType, handler)
  }

  private handleEvent(event: TaskEvent): void {
    const handler = this.eventHandlers.get(event.type)
    if (handler) {
      try {
        handler(event)
      } catch (error) {
        console.error(`Failed to handle event ${event.type}:`, error)
      }
    }
  }

  sendToTask(taskId: string, message: Record<string, unknown>): void {
    const ws = this.connections.get(taskId)
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  broadcast(message: Record<string, unknown>): void {
    for (const ws of this.connections.values()) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message))
      }
    }
  }

  close(): void {
    this.wss.close()
  }
}