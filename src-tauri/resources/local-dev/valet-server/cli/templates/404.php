<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Not Found — Badami Local Dev</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
               background: #0f0f12; color: #e8e8ed; margin: 0; min-height: 100vh;
               display: flex; align-items: center; justify-content: center; }
        .box { max-width: 36rem; padding: 2rem; text-align: center; }
        h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; }
        p { color: #a0a0ab; line-height: 1.5; margin: 0; }
        code { background: #1c1c24; padding: 0.1em 0.35em; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="box">
        <h1>404 — Site not found</h1>
        <p><?php echo isset($reason) ? $reason : 'No matching park path or Valet driver.'; ?></p>
        <p style="margin-top:1rem;font-size:0.875rem">Badami Local Dev</p>
    </div>
</body>
</html>
