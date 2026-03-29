-- Add content column to projects for BlockNote JSON
-- description stays as plain text, content holds editor JSON
ALTER TABLE projects ADD COLUMN content TEXT
