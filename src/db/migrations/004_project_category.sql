-- Migration 004: Add category column to projects
ALTER TABLE projects ADD COLUMN category TEXT
