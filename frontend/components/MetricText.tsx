import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MetricText({
  value,
  title,
  className,
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  const span = <span className={cn("font-mono tabular-nums", className)}>{value}</span>;
  if (!title) return span;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
