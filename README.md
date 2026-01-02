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
  node aritech-cli.js info                 - Show panel description info
  node aritech-cli.js monitor              - Start monitoring mode (COS events)
  node aritech-cli.js arm [area] [type] [--force]  - Arm area (default: area 1, type full)
                                             Types: full, part1, part2
                                             --force: Force arm despite faults/active zones
  node aritech-cli.js disarm [area]        - Disarm area (default: 1)
  node aritech-cli.js zones                - Show zone states
  node aritech-cli.js areas                - Show area states
  node aritech-cli.js outputs              - Show output names and states
  node aritech-cli.js triggers             - Show trigger names and states
  node aritech-cli.js inhibit <zone>       - Inhibit a zone
  node aritech-cli.js uninhibit <zone>     - Uninhibit a zone
  node aritech-cli.js activate <output>    - Activate an output
  node aritech-cli.js deactivate <output>  - Deactivate an output
  node aritech-cli.js trigger-activate <trigger>   - Activate a trigger
  node aritech-cli.js trigger-deactivate <trigger> - Deactivate a trigger
  node aritech-cli.js eventLog [count]     - Read event log (default: 50 events)

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
  node aritech-cli.js --host 192.168.1.100 --pin 1234 --encryptionKey <key> zones
  node aritech-cli.js --host 192.168.1.100 --username ADMIN --password SECRET --encryptionKey <key> zones
  node aritech-cli.js arm 1 full           - Full arm area 1
  node aritech-cli.js arm 1 part1          - Part arm 1 (set 1)
  node aritech-cli.js arm 2 part2          - Part arm 2 (set 2)
  node aritech-cli.js arm part1            - Part arm area 1 (default)
  node aritech-cli.js arm 1 full --force   - Force full arm area 1
  node aritech-cli.js outputs              - Show all outputs with states
  node aritech-cli.js activate 1           - Activate output 1
  node aritech-cli.js triggers             - Show all triggers with states
  node aritech-cli.js trigger-activate 1   - Activate trigger 1
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
- ✅ Activate / Deactivate outputs

### Triggers
- ✅ Read trigger names
- ✅ Read trigger states
- ✅ Monitor change events for triggers
- ✅ Activate / Deactivate triggers

## Contributing

Pull requests are welcome. We have no plans to implement additional functionality at this time, but contributions are appreciated.

## Disclaimer

This software is provided "as is" without warranty of any kind. Use at your own risk. The authors are not responsible for any damage or security issues that may arise from using this software.

This is an independent project developed through protocol analysis. It is not based on any proprietary source code or documentation.

## Trademarks

ATS, Advisor, and Aritech are trademarks of KGS Fire & Security. All other trademarks are the property of their respective owners. The use of these trademarks does not imply any affiliation with or endorsement by their owners.
