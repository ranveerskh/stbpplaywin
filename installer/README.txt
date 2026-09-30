STB PLAY latest-installer bootstrapper

Install-Latest.cmd checks the latest published GitHub Release and downloads
only the newest STB-PLAY Windows installer before launching it.

The repository workflow builds the Windows installer and publishes a GitHub
Release automatically after a versioned source commit reaches main. The
release must contain an asset matching:
Netplus-IPTV-Player-Setup-<version>.exe

The bootstrapper requires an internet connection. It does not collect portal,
MAC, PIN, or playback data.
