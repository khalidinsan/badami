const EXT_LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  py: "python",
  php: "php",
  rb: "ruby",
  go: "go",
  rs: "rust",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  xml: "xml",
  svg: "xml",
  dockerfile: "dockerfile",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  lua: "lua",
  r: "r",
  pl: "perl",
  pm: "perl",
  graphql: "graphql",
  gql: "graphql",
  tf: "hcl",
  hcl: "hcl",
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "shell",
  Vagrantfile: "ruby",
  ".gitignore": "plaintext",
  ".env": "ini",
  ".env.local": "ini",
  ".env.production": "ini",
  ".env.development": "ini",
  ".editorconfig": "ini",
  ".htaccess": "ini",
  "nginx.conf": "ini",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
};

export function detectLanguage(filename: string): string {
  // Check exact filename first
  if (FILENAME_LANGUAGE_MAP[filename]) {
    return FILENAME_LANGUAGE_MAP[filename];
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANGUAGE_MAP[ext] ?? "plaintext";
}

/** Returns true if the file extension suggests a text file that can be edited */
export function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const textExts = new Set([
    ...Object.keys(EXT_LANGUAGE_MAP),
    "txt", "log", "cfg", "env", "gitignore", "dockerignore",
    "editorconfig", "htaccess", "properties", "lock", "pid",
    "csv", "tsv", "rst", "tex", "bib",
  ]);
  return textExts.has(ext) || FILENAME_LANGUAGE_MAP[filename] !== undefined;
}
