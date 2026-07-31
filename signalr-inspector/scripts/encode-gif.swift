import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 4 else {
    fputs("Usage: encode-gif.swift <output.gif> <frame.png>...\n", stderr)
    exit(2)
}

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let frames = CommandLine.arguments.dropFirst(2).map { URL(fileURLWithPath: $0) }
guard let destination = CGImageDestinationCreateWithURL(
    output as CFURL,
    UTType.gif.identifier as CFString,
    frames.count,
    nil
) else {
    fputs("Could not create GIF destination.\n", stderr)
    exit(1)
}

CGImageDestinationSetProperties(destination, [
    kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
] as CFDictionary)

for frame in frames {
    guard
        let source = CGImageSourceCreateWithURL(frame as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        fputs("Could not read frame \(frame.path).\n", stderr)
        exit(1)
    }
    CGImageDestinationAddImage(destination, image, [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1.2]
    ] as CFDictionary)
}

guard CGImageDestinationFinalize(destination) else {
    fputs("Could not finalize GIF.\n", stderr)
    exit(1)
}
