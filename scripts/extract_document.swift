import Foundation
import PDFKit

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift extract_document.swift input.pdf\n", stderr)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: url) else {
    fputs("Could not open PDF: \(url.lastPathComponent)\n", stderr)
    exit(1)
}
for index in 0..<document.pageCount {
    let page = document.page(at: index)
    print("\n\u{001E}PAGE \(index + 1)\n")
    print(page?.string ?? "")
}
