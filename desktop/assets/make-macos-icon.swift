import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  fputs("usage: make-macos-icon.swift INPUT.png OUTPUT.png\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let source = NSImage(contentsOf: inputURL) else {
  fputs("could not load source icon\n", stderr)
  exit(3)
}

let dimension = 1024
guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: dimension,
  pixelsHigh: dimension,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("could not create icon bitmap\n", stderr)
  exit(4)
}

bitmap.size = NSSize(width: dimension, height: dimension)
guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("could not create icon graphics context\n", stderr)
  exit(5)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.imageInterpolation = .high

let canvas = NSRect(x: 0, y: 0, width: dimension, height: dimension)
NSColor.clear.setFill()
canvas.fill()

// The generated source intentionally leaves a safe margin around the tile.
// Clip that tile to a true alpha-backed macOS rounded-square silhouette so
// the generator's visual checkerboard never becomes part of the app icon.
let inset = CGFloat(dimension) * 0.108
let tile = canvas.insetBy(dx: inset, dy: inset)
let cornerRadius = CGFloat(dimension) * 0.145
NSBezierPath(roundedRect: tile, xRadius: cornerRadius, yRadius: cornerRadius).addClip()
source.draw(in: canvas, from: .zero, operation: .copy, fraction: 1)

graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("could not encode icon png\n", stderr)
  exit(6)
}

try png.write(to: outputURL, options: .atomic)
