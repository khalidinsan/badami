import { Badge } from "@/components/ui/badge";
import dayjs from "dayjs";

interface ExpiryBadgeProps {
  expiresAt: string;
}

export function ExpiryBadge({ expiresAt }: ExpiryBadgeProps) {
  const now = dayjs();
  const expiry = dayjs(expiresAt);
  const daysLeft = expiry.diff(now, "day");

  if (daysLeft < 0) {
    return (
      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
        Expired
      </Badge>
    );
  }

  if (daysLeft <= 7) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 border-red-400/40 text-red-500"
      >
        Expires in {daysLeft}d
      </Badge>
    );
  }

  if (daysLeft <= 30) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 border-amber-400/40 text-amber-500"
      >
        Expires in {daysLeft}d
      </Badge>
    );
  }

  return null;
}
