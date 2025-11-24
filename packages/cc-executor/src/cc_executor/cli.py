"""
Command-line interface for cc-executor.

Implements FR-013 (CLI parameters) and FR-004 (output formats).
"""

import sys
import click
import logging

from .models import ExecutionRequest, OutputFormat, DirtyWorktreePolicy, ExecutionStatus
from .executor import execute_instruction
from .exceptions import (
    CCExecutorError,
    ClaudeCodeNotFoundError,
    RepositoryNotFoundError,
    DirtyWorktreeError,
    ConcurrentExecutionError,
    ExecutionTimeoutError,
)


# Exit codes (per contracts/cli_interface.md)
EXIT_SUCCESS = 0
EXIT_GENERAL_ERROR = 1
EXIT_INVALID_ARGS = 2
EXIT_CLAUDE_NOT_FOUND = 3
EXIT_REPO_NOT_FOUND = 4
EXIT_DIRTY_WORKTREE = 5
EXIT_TIMEOUT = 6
EXIT_CONCURRENT_EXECUTION = 7


@click.command()
@click.option(
    "--instruction",
    "-i",
    required=True,
    help="Text instruction to pass to Claude Code",
)
@click.option(
    "--output-format",
    "-f",
    type=click.Choice(["text", "json", "stream-json"], case_sensitive=False),
    default="text",
    help="Output format (default: text)",
)
@click.option(
    "--timeout",
    "-t",
    type=int,
    default=600,
    help="Execution timeout in seconds (default: 600)",
)
@click.option(
    "--dirty-worktree",
    type=click.Choice(["block", "stash", "allow"], case_sensitive=False),
    default="block",
    help="How to handle uncommitted changes (default: block)",
)
@click.option(
    "--repo-path",
    "-r",
    type=click.Path(exists=True),
    default=None,
    help="Path to Git repository (default: current directory)",
)
@click.option(
    "--verbose",
    "-v",
    is_flag=True,
    help="Enable verbose logging",
)
def main(
    instruction: str,
    output_format: str,
    timeout: int,
    dirty_worktree: str,
    repo_path: str,
    verbose: bool,
):
    """
    Claude Code Executor - Execute Claude Code instructions via CLI.

    Example:
        cc-executor --instruction "Add hello world function"
    """
    # Configure logging
    if verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    try:
        # Build request
        request = ExecutionRequest(
            instruction=instruction,
            output_format=OutputFormat(output_format.replace("-", "_").upper()),
            timeout=timeout,
            dirty_worktree=DirtyWorktreePolicy(dirty_worktree.upper()),
            repo_path=repo_path,
            verbose=verbose,
        )

        # Execute
        result = execute_instruction(request)

        # Format output (FR-004)
        if request.output_format == OutputFormat.TEXT:
            _print_text_output(result)
        elif request.output_format == OutputFormat.JSON:
            _print_json_output(result)
        elif request.output_format == OutputFormat.STREAM_JSON:
            _print_stream_json_output(result)

        # Exit with appropriate code
        if result.status == ExecutionStatus.SUCCESS:
            sys.exit(EXIT_SUCCESS)
        elif result.status == ExecutionStatus.TIMEOUT:
            sys.exit(EXIT_TIMEOUT)
        else:
            sys.exit(EXIT_GENERAL_ERROR)

    except ClaudeCodeNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_CLAUDE_NOT_FOUND)

    except RepositoryNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_REPO_NOT_FOUND)

    except DirtyWorktreeError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_DIRTY_WORKTREE)

    except ExecutionTimeoutError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_TIMEOUT)

    except ConcurrentExecutionError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_CONCURRENT_EXECUTION)

    except CCExecutorError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(EXIT_GENERAL_ERROR)

    except ValueError as e:
        click.echo(f"Invalid argument: {e}", err=True)
        sys.exit(EXIT_INVALID_ARGS)

    except Exception as e:
        click.echo(f"Unexpected error: {e}", err=True)
        sys.exit(EXIT_GENERAL_ERROR)


def _print_text_output(result) -> None:
    """Format and print result as human-readable text."""
    click.echo("=" * 60)
    click.echo(f"Execution Status: {result.status.value.upper()}")
    click.echo(f"Request ID: {result.request_id}")
    click.echo(f"Session ID: {result.session_id}")
    click.echo(f"Execution Time: {result.execution_time:.2f}s")
    click.echo("=" * 60)

    if result.error_message:
        click.echo(f"\nError: {result.error_message}", err=True)

    if result.stdout:
        click.echo("\n--- Claude Code Output ---")
        click.echo(result.stdout)

    if result.stderr:
        click.echo("\n--- Errors/Warnings ---", err=True)
        click.echo(result.stderr, err=True)

    if result.commit_hash:
        click.echo(f"\n--- Git Commit ---")
        click.echo(f"Commit: {result.commit_hash}")

    if result.files_changed:
        click.echo(f"\n--- Files Changed ({len(result.files_changed)}) ---")
        for file_path in result.files_changed:
            click.echo(f"  - {file_path}")

    if result.diff:
        click.echo("\n--- Diff ---")
        click.echo(result.diff)


def _print_json_output(result) -> None:
    """Format and print result as JSON."""
    import json

    output = {
        "request_id": result.request_id,
        "status": result.status.value,
        "instruction": result.instruction,
        "files_changed": result.files_changed,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "execution_time": result.execution_time,
        "session_id": result.session_id,
        "timestamp": result.timestamp.isoformat(),
        "diff": result.diff,
        "commit_hash": result.commit_hash,
        "error_message": result.error_message,
    }

    click.echo(json.dumps(output, indent=2))


def _print_stream_json_output(result) -> None:
    """Format and print result as stream-JSON (NDJSON)."""
    import json

    # Stream-JSON outputs each field as a separate JSON object (one per line)
    fields = {
        "request_id": result.request_id,
        "status": result.status.value,
        "instruction": result.instruction,
        "files_changed": result.files_changed,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "execution_time": result.execution_time,
        "session_id": result.session_id,
        "timestamp": result.timestamp.isoformat(),
        "diff": result.diff,
        "commit_hash": result.commit_hash,
        "error_message": result.error_message,
    }

    for key, value in fields.items():
        click.echo(json.dumps({key: value}))


if __name__ == "__main__":
    main()
