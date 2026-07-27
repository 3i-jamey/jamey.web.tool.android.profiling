export function normalizeKoreanStrongSpacing(markdown: string) {
  return markdown.replace(/(\*\*[^\n]+?\*\*)(?=[가-힣])/g, '$1 ')
}
