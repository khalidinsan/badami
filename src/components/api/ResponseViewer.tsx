import { CodeEditor } from "./CodeEditor";

interface ResponseViewerProps {
  body: string;
  className?: string;
}

export function ResponseViewer({ body, className = "" }: ResponseViewerProps) {
  // Try to detect if the body is JSON and pretty-print it
  let formatted = body;
  let language: "json" | "xml" | "text" = "text";

  try {
    const parsed = JSON.parse(body);
    formatted = JSON.stringify(parsed, null, 2);
    language = "json";
  } catch {
    // Check if XML
    if (body.trim().startsWith("<")) {
      language = "xml";
    }
  }

  return (
    <CodeEditor
      value={formatted}
      readOnly
      language={language}
      className={className}
      minHeight="200px"
    />
  );
}
