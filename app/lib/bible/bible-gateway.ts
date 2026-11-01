export function bibleGatewayEsvUrl(referenceLabel: string): string {
  const params = new URLSearchParams({
    search: referenceLabel,
    version: "ESV",
  });
  return `https://www.biblegateway.com/passage/?${params.toString()}`;
}
