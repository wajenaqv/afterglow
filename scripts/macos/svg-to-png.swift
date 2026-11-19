// Rasterise an SVG to a PNG at its own pixel size, with macOS's own SVG
// support (NSImage, macOS 14+), so no extra tools are needed.
// Used for the menu bar icon, which isn't square (`tauri icon` makes squares):
//   swift scripts/macos/svg-to-png.swift assets/icon/tray-mac.svg src-tauri/icons/tray/mac/tray.png
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let image = NSImage(contentsOfFile: args[1]) else {
    FileHandle.standardError.write("usage: svg-to-png.swift in.svg out.png\n".data(using: .utf8)!)
    exit(1)
}
let w = Int(image.size.width), h = Int(image.size.height)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = image.size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
image.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2]) (\(w)x\(h))")
