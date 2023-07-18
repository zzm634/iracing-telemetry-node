# iracing-telemetry-node

A nodejs-native library for reading iracing telemetry

This project is far from complete. If you're looking for something you can use right now, check out [node-irsdk-2021](https://github.com/mcalapurge/node-irsdk).

## Goals

- an RxJS interface for reading telemetry from iRacing
- Native processing of .ibt telemetry files and live telemetry (i.e., not re-using a C# library)
- Same interface for live telemetry and disk telemetry
- Read **disk** telemetry live (on whatever delay is enforced by iRacing). Disk telemtry contains more information, including
  - GPS coordinates
  - Tire temperatures and pressures
  - Ride height

### Stretch goals

- Type-safe declarations for all temetry variables
  - Obviously, all values will be parsed safely, but it'll be a while before I have an interface with declarations for all telemetry variables. It's gonna be `telemetry.getValue("dcBrakeBias")` for a while

## Challenges

### Memory-mapped files and data ready events

iRacing uses some windows-specific features to let applications read telemetry data: a memory-mapped file containing the data (`OpenFileMappingW`) and an event publisher that signals when a new telemetry sample is ready (`OpenEventA`). I'm going to have to do some native API work to access these from nodejs. Probably going to use Koffi to do it.

Reading the file needs to be fast, since they come once every 16 milliseconds. Node is not known for its high-performance, so I'm really hoping it can get this done fast enough.

Also, presenting this all as an Observable is going to be tricky. Lots of weird blocking gonna happen.

### Tailing .ibt files

I don't think anyone has tried to do this, so I don't know if it's going to work. It's probably reasonable to tail an .ibt file to get new telemetry samples, but as far as I can tell, .ibt files only have one session info section at the top of the file. I assume that iRacing writes changes to the one session info section at the top of the file while appending telemetry samples to the end of the file. We're going to have to check this part of the file every time it has data appended to it, but at least we don't have to parse the yaml every time.

There's also the very real possibility that we won't get complete telemetry sample updates every time the file is written to, so our ibt parser is going to have to be flexible WRT data buffers.

Lots of work to do.
