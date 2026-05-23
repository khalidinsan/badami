import { invoke } from '@tauri-apps/api/core';

export const IDE_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file on the remote server. You MUST specify a line range. If the file is large, read it in multiple calls with different ranges.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          start_line: { type: 'number', description: 'Start line number (0-based). Default 0.' },
          end_line: { type: 'number', description: 'End line number (0-based, inclusive). Default 200.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory on the remote server',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files by name pattern in a directory recursively using find command',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory to search in' },
          pattern: { type: 'string', description: 'File name pattern (glob, e.g. *.ts)' },
        },
        required: ['directory', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Propose an edit to a file. Returns the new content that should replace the file content. The user will review and accept/reject.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file to edit' },
          new_content: { type: 'string', description: 'The complete new file content' },
          description: { type: 'string', description: 'Brief description of what was changed' },
        },
        required: ['path', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file on the remote server with the given content. Use this to write new files (not for editing existing ones).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path for the new file' },
          content: { type: 'string', description: 'The file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command on the remote server via SSH. Returns stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
];

export interface ToolResult {
  type: 'text' | 'edit_proposal';
  content: string;
  // For edit_proposal
  filePath?: string;
  newContent?: string;
  description?: string;
}

export async function executeIdeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
  sshSessionId: string,
): Promise<ToolResult> {
  switch (name) {
    case 'read_file': {
      const content = await invoke<string>('sftp_read_file', { sessionId, path: args.path as string });
      const lines = content.split('\n');
      const start = Math.max(0, (args.start_line as number) || 0);
      const end = Math.min(lines.length - 1, (args.end_line as number) ?? 200);
      const slice = lines.slice(start, end + 1).join('\n');
      const header = `[Lines ${start}-${end} of ${lines.length} total]\n`;
      return { type: 'text', content: header + slice };
    }
    case 'list_directory': {
      const items = await invoke<any[]>('sftp_list_dir', { sessionId, path: args.path as string });
      const sorted = items.sort((a: any, b: any) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
      const formatted = sorted.slice(0, 50)
        .map((i: any) => `${i.kind === 'directory' ? 'd' : '-'} ${i.name}`)
        .join('\n') + (items.length > 50 ? `\n... and ${items.length - 50} more items` : '');
      return { type: 'text', content: formatted };
    }
    case 'search_files': {
      // Use SSH to run find command
      try {
        const cmd = `find ${args.directory} -name '${args.pattern}' -type f 2>/dev/null | head -50`;
        const result = await invoke<string>('ssh_exec_command', { sessionId: sshSessionId, command: cmd });
        return { type: 'text', content: result || 'No files found' };
      } catch {
        return { type: 'text', content: 'Search failed - SSH not connected' };
      }
    }
    case 'edit_file': {
      return {
        type: 'edit_proposal',
        content: `Edit proposed for ${args.path}: ${(args.description as string) || 'No description'}`,
        filePath: args.path as string,
        newContent: args.new_content as string,
        description: (args.description as string) || '',
      };
    }
    case 'create_file': {
      try {
        await invoke('sftp_write_file', { sessionId, path: args.path as string, content: args.content as string });
        return { type: 'text', content: `File created: ${args.path}` };
      } catch (e: any) {
        return { type: 'text', content: `Failed to create file: ${e}` };
      }
    }
    case 'run_command': {
      try {
        const result = await invoke<string>('ssh_exec_command', { sessionId: sshSessionId, command: args.command as string });
        return { type: 'text', content: result || '(no output)' };
      } catch (e: any) {
        return { type: 'text', content: `Error: ${e}` };
      }
    }
    default:
      return { type: 'text', content: `Unknown tool: ${name}` };
  }
}
