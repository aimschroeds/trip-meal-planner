function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(filename: string, text: string) {
  download(filename, text, 'text/csv;charset=utf-8')
}

export function downloadJson(filename: string, text: string) {
  download(filename, text, 'application/json')
}
