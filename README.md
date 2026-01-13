# Aritech Client (Unofficial)

An unofficial, community-developed JavaScript client to monitor and control KGS (formerly UTC & Carrier) Aritech alarm panels over your local network.

**This project is not affiliated with, endorsed by, or supported by KGS, UTC, Carrier, or any of their subsidiaries.**

## Compatibility

This library supports the ACE 2 ATS version 6 protocol, which works with Advisor Advanced panels:

- **x500 panels**: ATS1500A, ATS2000A, ATS3500A, ATS4500A (PIN-based login, AES-192)
- **x700 (everon) panels**: ATS1500A-IP-MM, ATS3500A-IP-MM, ATS4500A-IP-MM (username/password login, AES-256)

The older version 4 protocol for Master/Classic panels is not supported.

Note that protocol behavior may vary based on panel firmware version. This library has been tested with a limited set of panels. If you encounter issues, please mention your panel model and firmware version when reporting.

## Installation

Clone the repository and create a `config.json` file based on your panel type:

**For x500 panels (ATS1500A, ATS2000A, ATS3500A, ATS4500A):**

Copy `config.x500.json.example` to `config.json` and edit with your settings:

```json
{
  "host": "192.168.1.100",
  "port": 3001,
  "pin": "1234",
  "encryptionKey": "your-24-char-encryption-key"
}
```

**For x700 panels (ATS1500A-IP-MM, ATS3500A-IP-MM, ATS4500A-IP-MM):**

Copy `config.x700.json.example` to `config.json` and edit with your settings:

```json
{
  "host": "192.168.1.100",
  "port": 3001,
  "username": "ADMIN",
  "password": "SECRET",
  "encryptionKey": "your-48-char-encryption-key"
}
```


## Usage

```
node aritech-cli.js
```

For troubleshooting, enable debug logging:

```
LOG_LEVEL=debug node aritech-cli.js
```

Note: Debug logs may contain sensitive information such as your PIN code.

### Commands

```
Available commands:
  aritech info                 - Show panel description info
  aritech monitor              - Start monitoring mode (COS events)
  aritech arm [area] [type] [--force]  - Arm area (default: area 1, type full)
                                 Types: full, part1, part2
                                 --force: Force arm despite faults/active zones
  aritech disarm [area]        - Disarm area (default: 1)
  aritech zones                - Show zone states
  aritech areas                - Show area states
  aritech outputs              - Show output names and states
  aritech triggers             - Show trigger names and states
  aritech doors                - Show door names and states
  aritech inhibit <zone>       - Inhibit a zone
  aritech uninhibit <zone>     - Uninhibit a zone
  aritech force-activate <output>   - Force activate an output (override to ON)
  aritech force-deactivate <output> - Force deactivate an output (override to OFF)
  aritech cancel-force <output>     - Cancel force on output (return to normal)
  aritech trigger-activate <trigger>   - Activate a trigger
  aritech trigger-deactivate <trigger> - Deactivate a trigger
  aritech door-lock <door>     - Lock a door
  aritech door-unlock <door>   - Unlock a door (indefinitely)
  aritech door-unlock-standard <door> - Unlock door for standard configured time
  aritech door-unlock-timed <door> <seconds> - Unlock door for specified seconds
  aritech door-disable <door>  - Disable a door
  aritech door-enable <door>   - Enable a door
  aritech eventLog [count]     - Read event log (default: 50 events)

Configuration options (override config.json):
  --host <ip>              - Panel IP address
  --port <port>            - Panel port number
  --encryptionKey <key>    - Encryption key (24-48 chars)

  x500 panels:
  --pin <pin>              - User PIN code

  x700 panels:
  --username <user>        - Login username
  --password <pwd>         - Login password (defaults to username)

Examples:
  aritech --host 192.168.1.100 --pin 1234 --encryptionKey <key> zones
  aritech --host 192.168.1.100 --username ADMIN --password SECRET --encryptionKey <key> zones
  aritech arm 1 full           - Full arm area 1
  aritech arm 1 part1          - Part arm 1 (set 1)
  aritech arm 2 part2          - Part arm 2 (set 2)
  aritech arm part1            - Part arm area 1 (default)
  aritech arm 1 full --force   - Force full arm area 1
  aritech outputs              - Show all outputs with states
  aritech force-activate 1     - Force activate output 1 (override to ON)
  aritech cancel-force 1       - Cancel force on output 1 (return to normal)
  aritech triggers             - Show all triggers with states
  aritech trigger-activate 1   - Activate trigger 1

```

## Features

### Basic
- ✅ Connect to panel and retrieve panel description
- ✅ Session key exchange
- ✅ Login with PIN code (x500 panels)
- ✅ Login with username/password (x700 panels)
- ✅ Read event log

### Areas
- ✅ Read area names
- ✅ Read area status (batched or individual)
- ✅ Monitor change events for areas
- ✅ Arm / Partial arm / Disarm areas

### Zones
- ✅ Read zone names
- ✅ Read zone status (batched or individual)
- ✅ Monitor change events for zones
- ✅ Inhibit / uninhibit zones

### Outputs
- ✅ Read output names
- ✅ Read output states
- ✅ Monitor change events for outputs
- ✅ Force activate / Force deactivate / Cancel force outputs

Note that only with an installer pin you can force the status of an output.
An installer pin by default does not have arming/disarming permissions!

### Triggers
- ✅ Read trigger names
- ✅ Read trigger states
- ✅ Monitor change events for triggers
- ✅ Activate / Deactivate triggers

### Doors
- ✅ Read door names
- ✅ Read door states
- ✅ Monitor change events for triggers
- ✅ Enable / Disable doors
- ✅ Lock / Unlock doors
- ✅ Timed and standard time unlock

## Contributing

Pull requests are welcome. We have no plans to implement additional functionality at this time, but contributions are appreciated.

## Disclaimer

This software is provided "as is" without warranty of any kind. Use at your own risk. The authors are not responsible for any damage or security issues that may arise from using this software.

This is an independent project developed through protocol analysis. It is not based on any proprietary source code or documentation.

## Trademarks

ATS, Advisor, and Aritech are trademarks of KGS Fire & Security. All other trademarks are the property of their respective owners. The use of these trademarks does not imply any affiliation with or endorsement by their owners.
