import type { CredentialType } from "@/types/credential";

export interface FieldSchema {
  key: string;
  label: string;
  sensitive: boolean;
  /** placeholder text */
  placeholder?: string;
  /** "text" | "select" | "textarea" */
  inputType?: string;
  /** options for select fields */
  options?: { value: string; label: string }[];
  /** auto-fill into credential.username / url / service_name */
  mapTo?: "username" | "url" | "service_name";
}

const PLATFORM_OPTIONS = [
  { value: "iOS", label: "iOS" },
  { value: "Android", label: "Android" },
  { value: "Desktop", label: "Desktop" },
  { value: "Web", label: "Web" },
];

const DB_TYPE_OPTIONS = [
  { value: "MySQL", label: "MySQL" },
  { value: "PostgreSQL", label: "PostgreSQL" },
  { value: "MongoDB", label: "MongoDB" },
  { value: "Redis", label: "Redis" },
  { value: "Other", label: "Other" },
];

export const CREDENTIAL_FIELD_SCHEMAS: Record<CredentialType, FieldSchema[]> = {
  web_login: [
    { key: "url", label: "URL / Website", sensitive: false, placeholder: "https://dash.cloudflare.com", mapTo: "url" },
    { key: "username", label: "Username / Email", sensitive: false, placeholder: "admin@company.com", mapTo: "username" },
    { key: "password", label: "Password", sensitive: true },
  ],
  app_account: [
    { key: "app_name", label: "App Name", sensitive: false, placeholder: "My App", mapTo: "service_name" },
    { key: "platform", label: "Platform", sensitive: false, inputType: "select", options: PLATFORM_OPTIONS },
    { key: "username", label: "Username / Email", sensitive: false, placeholder: "testuser@example.com", mapTo: "username" },
    { key: "password", label: "Password", sensitive: true },
  ],
  api_key: [
    { key: "service_name", label: "Service Name", sensitive: false, placeholder: "Stripe", mapTo: "service_name" },
    { key: "key_name", label: "Key Name", sensitive: false, placeholder: "Secret Key" },
    { key: "value", label: "Value", sensitive: true },
  ],
  database: [
    { key: "db_type", label: "DB Type", sensitive: false, inputType: "select", options: DB_TYPE_OPTIONS },
    { key: "host", label: "Host", sensitive: false, placeholder: "db.example.com" },
    { key: "port", label: "Port", sensitive: false, placeholder: "3306" },
    { key: "database_name", label: "Database Name", sensitive: false, placeholder: "mydb" },
    { key: "username", label: "Username", sensitive: false, placeholder: "root", mapTo: "username" },
    { key: "password", label: "Password", sensitive: true },
    { key: "connection_string", label: "Connection String", sensitive: true, placeholder: "mysql://user:pass@host:port/db" },
  ],
  email: [
    { key: "email_address", label: "Email Address", sensitive: false, placeholder: "mail@company.com", mapTo: "username" },
    { key: "password", label: "Password", sensitive: true },
    { key: "smtp_host", label: "SMTP Host", sensitive: false, placeholder: "smtp.gmail.com" },
    { key: "smtp_port", label: "SMTP Port", sensitive: false, placeholder: "587" },
    { key: "imap_host", label: "IMAP Host", sensitive: false, placeholder: "imap.gmail.com" },
  ],
  license: [
    { key: "product_name", label: "Product Name", sensitive: false, placeholder: "JetBrains IntelliJ IDEA", mapTo: "service_name" },
    { key: "license_key", label: "License Key", sensitive: true },
    { key: "registered_to", label: "Registered To", sensitive: false, placeholder: "John Doe" },
    { key: "max_seats", label: "Max Seats", sensitive: false, placeholder: "1" },
    { key: "purchase_url", label: "Purchase URL", sensitive: false, placeholder: "https://...", mapTo: "url" },
  ],
  secure_note: [
    { key: "content", label: "Content", sensitive: true, inputType: "textarea" },
  ],
  env_vars: [],
  server_access: [
    { key: "host", label: "Host / IP", sensitive: false, placeholder: "192.168.1.100" },
    { key: "port", label: "Port", sensitive: false, placeholder: "22" },
    { key: "username", label: "Username", sensitive: false, placeholder: "root", mapTo: "username" },
    { key: "password", label: "Password / Key", sensitive: true },
  ],
};
