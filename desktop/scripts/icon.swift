import AppKit
let image=NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedWhite:0.11,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:20,y:20,width:984,height:984),xRadius:190,yRadius:190).fill()
NSColor(calibratedRed:0.886,green:0.471,blue:0.471,alpha:1).setFill()
NSBezierPath(rect:NSRect(x:190,y:225,width:45,height:575)).fill()
let text="A" as NSString
text.draw(at:NSPoint(x:292,y:185),withAttributes:[.font:NSFont.systemFont(ofSize:640,weight:.semibold),.foregroundColor:NSColor(calibratedRed:0.90,green:0.89,blue:0.87,alpha:1)])
image.unlockFocus()
let data=NSBitmapImageRep(data:image.tiffRepresentation!)!.representation(using:.png,properties:[:])!
try data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
