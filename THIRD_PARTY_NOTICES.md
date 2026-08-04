# Third-Party Notices

Listener uses the direct npm dependencies listed in `package.json`. Their license identifiers are documented in `docs/music-core-license-audit.md`; full license texts remain available in each installed package and its upstream distribution.

Architecture research referenced the archived MIT-licensed project [maicong/music](https://github.com/maicong/music), Copyright (c) 2015 Maicong, at commit `cc30b8636dc6c4df62bf467b0638363a4217f368`. Its README adds a non-commercial statement that is ambiguous with the MIT grant. No source code, templates, assets, vendor files, private API implementations, signature logic, or playback URL generation from that project are included here. The new implementation is a clean-room design based on this repository's existing Node architecture and documented behavior only.

Wikimedia Commons search uses the official MediaWiki Action API without bundling third-party code or media. Audio remains hosted by Wikimedia; each file's source page states its author, license, and attribution requirements. Listener does not proxy, cache, or expose a download operation for these files.
