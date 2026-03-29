import dayjs from "dayjs";

export function now(): string {
  return dayjs().toISOString();
}

export function today(): string {
  return dayjs().format("YYYY-MM-DD");
}

export function formatDate(date: string): string {
  return dayjs(date).format("MMM D, YYYY");
}

export function formatDateTime(date: string): string {
  return dayjs(date).format("MMM D, YYYY h:mm A");
}

export function isToday(date: string): boolean {
  return dayjs(date).isSame(dayjs(), "day");
}

export function isPast(date: string): boolean {
  return dayjs(date).isBefore(dayjs(), "day");
}
