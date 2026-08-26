export function resolveAccountUsagePercent(input: {
  reportedPercent?: number;
  hasCurrentPeriod: boolean;
  onDemandUsed?: number;
  onDemandCap?: number;
}): number | undefined {
  if (input.reportedPercent != null) return input.reportedPercent;
  if (input.onDemandUsed != null && input.onDemandCap != null && input.onDemandCap > 0) {
    return (input.onDemandUsed / input.onDemandCap) * 100;
  }
  return input.hasCurrentPeriod ? 0 : undefined;
}
