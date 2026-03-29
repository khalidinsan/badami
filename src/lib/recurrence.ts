import { RRule } from "rrule";
import dayjs from "dayjs";

export function getNextOccurrence(rruleStr: string, afterDate: Date): Date | null {
  const rule = RRule.fromString(rruleStr);
  return rule.after(afterDate, false);
}

export function buildRRuleString(
  freq: "daily" | "weekly" | "monthly",
  options?: {
    byDay?: number[];   // 0=MO, 1=TU, ..., 6=SU (RRule.MO etc.)
    byMonthDay?: number;
    interval?: number;
  },
): string {
  const freqMap = {
    daily: RRule.DAILY,
    weekly: RRule.WEEKLY,
    monthly: RRule.MONTHLY,
  };

  const ruleOptions: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: freqMap[freq],
    interval: options?.interval ?? 1,
  };

  if (options?.byDay && freq === "weekly") {
    const dayMap = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
    ruleOptions.byweekday = options.byDay.map((d) => dayMap[d]);
  }

  if (options?.byMonthDay !== undefined && freq === "monthly") {
    ruleOptions.bymonthday = [options.byMonthDay];
  }

  return new RRule(ruleOptions as ConstructorParameters<typeof RRule>[0]).toString();
}

export function describeRRule(rruleStr: string): string {
  if (!rruleStr) return "No repeat";
  try {
    const rule = RRule.fromString(rruleStr);
    return rule.toText();
  } catch {
    return "Custom repeat";
  }
}

export function getNextDueDate(rruleStr: string, currentDueDate: string): string | null {
  const current = dayjs(currentDueDate).toDate();
  const next = getNextOccurrence(rruleStr, current);
  if (!next) return null;
  return dayjs(next).format("YYYY-MM-DD");
}
