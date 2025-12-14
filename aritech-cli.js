import { AritechClient, AritechError } from './aritech-client.js';
import { AritechMonitor } from './aritech-monitor.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration from config.json if it exists
function loadConfig() {
  try {
    const configPath = join(__dirname, 'config.json');
    const configFile = readFileSync(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (err) {
    // If config.json doesn't exist or is invalid, return empty config
    return {};
  }
}

// Parse CLI arguments for configuration options
function parseConfigArgs(args) {
  const config = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];

      switch (key) {
        case 'host':
          config.host = value;
          i++;
          break;
        case 'port':
          config.port = parseInt(value);
          i++;
          break;
        case 'pin':
          config.pin = value;
          i++;
          break;
        case 'encryptionPassword':
        case 'password':
          config.encryptionPassword = value;
          i++;
          break;
      }
    }
  }
  return config;
}

// Build final configuration: config.json < CLI args
const allArgs = process.argv.slice(2);
const configFromFile = loadConfig();
const configFromArgs = parseConfigArgs(allArgs);
const CONFIG = { ...configFromFile, ...configFromArgs };

// Validate required configuration fields
const requiredFields = ['host', 'port', 'pin', 'encryptionPassword'];
const missingFields = requiredFields.filter(field => !CONFIG[field]);

if (missingFields.length > 0) {
  console.error('\n❌ Error: Missing required configuration fields:');
  missingFields.forEach(field => console.error(`   - ${field}`));
  console.error('\nPlease provide missing fields either in config.json or via CLI arguments.');
  console.error('Example: node aritech-cli.js --host 192.168.1.1 --port 32000 --pin 1278 --password 000000000000000000000000 zones');
  process.exit(1);
}

const client = new AritechClient(CONFIG);

// Get the command (first non-config argument)
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--') && !Object.values(configFromArgs).includes(arg));
const command = args[0];

// Show help if no command given (without connecting to panel)
if (!command) {
  console.log('\nAvailable commands:');
  console.log('  node aritech-cli.js info                 - Show panel description info');
  console.log('  node aritech-cli.js monitor              - Start monitoring mode (COS events)');
  console.log('  node aritech-cli.js arm [area] [type] [--force]  - Arm area (default: area 1, type full)');
  console.log('                                             Types: full, part1, part2');
  console.log('                                             --force: Force arm despite faults/active zones');
  console.log('  node aritech-cli.js disarm [area]        - Disarm area (default: 1)');
  console.log('  node aritech-cli.js zones                - Show zone states');
  console.log('  node aritech-cli.js areas                - Show area states');
  console.log('  node aritech-cli.js outputs              - Show output names and states');
  console.log('  node aritech-cli.js triggers             - Show trigger names and states');
  console.log('  node aritech-cli.js inhibit <zone>       - Inhibit a zone');
  console.log('  node aritech-cli.js uninhibit <zone>     - Uninhibit a zone');
  console.log('  node aritech-cli.js activate <output>    - Activate an output');
  console.log('  node aritech-cli.js deactivate <output>  - Deactivate an output');
  console.log('  node aritech-cli.js trigger-activate <trigger>   - Activate a trigger');
  console.log('  node aritech-cli.js trigger-deactivate <trigger> - Deactivate a trigger');
  console.log('  node aritech-cli.js eventLog [count]     - Read event log (default: 50 events)');
  console.log('\nConfiguration options (override config.json):');
  console.log('  --host <ip>          - Panel IP address');
  console.log('  --port <port>        - Panel port number');
  console.log('  --pin <pin>          - User PIN code');
  console.log('  --password <pwd>     - Encryption password');
  console.log('\nExamples:');
  console.log('  node aritech-cli.js --host 192.168.1.100 --pin 1234 zones');
  console.log('  node aritech-cli.js arm 1 full           - Full arm area 1');
  console.log('  node aritech-cli.js arm 1 part1          - Part arm 1 (set 1)');
  console.log('  node aritech-cli.js arm 2 part2          - Part arm 2 (set 2)');
  console.log('  node aritech-cli.js arm part1            - Part arm area 1 (default)');
  console.log('  node aritech-cli.js arm 1 full --force   - Force full arm area 1');
  console.log('  node aritech-cli.js outputs              - Show all outputs with states');
  console.log('  node aritech-cli.js activate 1           - Activate output 1');
  console.log('  node aritech-cli.js triggers             - Show all triggers with states');
  console.log('  node aritech-cli.js trigger-activate 1   - Activate trigger 1');
  process.exit(0);
}


try {
  await client.connect();
  await client.getDescription();

  if (command === 'info') {
    console.log('\nPanel Information:');
    console.log(`  Name:     ${client.panelName || 'unknown'}`);
    console.log(`  Model:    ${client.panelModel || 'unknown'}`);
    console.log(`  Serial:   ${client.config.serial || 'unknown'}`);
    console.log(`  Firmware: ${client.firmwareVersion || 'unknown'}`);
    console.log(`  Protocol: ${client.protocolVersion || 'unknown'}`);
    process.exit(0);
  }
  await client.changeSessionKey();
  const success = await client.login();

  if (success) {
    // Check command line args for arm/disarm/zones
    if (command === 'info') {
      console.log('\nPanel Information:');
      console.log(`  Name:     ${client.panelName || 'unknown'}`);
      console.log(`  Model:    ${client.panelModel || 'unknown'}`);
      console.log(`  Serial:   ${client.config.serial || 'unknown'}`);
      console.log(`  Firmware: ${client.firmwareVersion || 'unknown'}`);
      console.log(`  Protocol: ${client.protocolVersion || 'unknown'}`);
    } else if (command === 'monitor') {
      // Create monitor instance
      const monitor = new AritechMonitor(client);

      // Set up event handlers
      monitor.on('initialized', (data) => {
        console.log(`\n✓ Monitor initialized`);
        console.log(`  Zones: ${data.zones.length} tracked`);
        console.log(`  Areas: ${data.areas.length} tracked`);
        console.log(`  Outputs: ${data.outputs.length} tracked`);
        console.log(`  Triggers: ${data.triggers.length} tracked\n`);
      });

      monitor.on('zoneChanged', (event) => {
        const { id, name, oldData, newData } = event;

        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`📍 Zone ${id} (${name}) changed:`);
          console.log(`   State: ${JSON.stringify(oldData, null, 2)} → ${JSON.stringify(newData, null, 2)}`);
        } else {
          // Show only state and changed flags
          const oldState = oldData?.state || 'unknown';
          const newState = newData?.state || 'unknown';
          console.log(`📍 Zone ${id} (${name}): ${oldState} → ${newState}`);

          // Show changed flags
          if (oldData && newData) {
            const changedFlags = [];
            for (const [key, value] of Object.entries(newData.flags || {})) {
              if (oldData.flags?.[key] !== value) {
                changedFlags.push(`${key}: ${oldData.flags?.[key]} -> ${value}`);
              }
            }
            if (changedFlags.length > 0) {
              console.log(`   Changed flags: ${changedFlags.join(', ')}`);
            }
          }
        }
      });

      monitor.on('areaChanged', (event) => {
        const { id, name, oldData, newData } = event;

        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`🏠 Area ${id} (${name}) changed:`);
          console.log(`   State: ${JSON.stringify(oldData, null, 2)} → ${JSON.stringify(newData, null, 2)}`);
        } else {
          // Show only state and changed flags
          const oldState = oldData?.state?.toString() || 'unknown';
          const newState = newData?.state?.toString() || 'unknown';
          console.log(`🏠 Area ${id} (${name}): ${oldState} → ${newState}`);

          // Show changed flags
          if (oldData?.state && newData?.state) {
            const changedFlags = [];
            for (const [key, value] of Object.entries(newData.state)) {
              if (typeof value === 'boolean' && oldData.state[key] !== value) {
                changedFlags.push(`${key}: ${oldData.state[key]} -> ${value}`);
              }
            }
            if (changedFlags.length > 0) {
              console.log(`   Changed flags: ${changedFlags.join(', ')}`);
            }
          }
        }
      });

      monitor.on('outputChanged', (event) => {
        const { id, name, oldData, newData } = event;

        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`💡 Output ${id} (${name}) changed:`);
          console.log(`   State: ${JSON.stringify(oldData, null, 2)} → ${JSON.stringify(newData, null, 2)}`);
        } else {
          const oldState = oldData?.state || 'unknown';
          const newState = newData?.state || 'unknown';
          console.log(`💡 Output ${id} (${name}): ${oldState} → ${newState}`);
        }
      });

      monitor.on('triggerChanged', (event) => {
        const { id, name, oldData, newData } = event;

        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`⚡ Trigger ${id} (${name}) changed:`);
          console.log(`   State: ${JSON.stringify(oldData, null, 2)} → ${JSON.stringify(newData, null, 2)}`);
        } else {
          const oldState = oldData?.state || 'unknown';
          const newState = newData?.state || 'unknown';
          console.log(`⚡ Trigger ${id} (${name}): ${oldState} → ${newState}`);
        }
      });

      monitor.on('error', (err) => {
        console.error(`\n❌ Monitor error: ${err.message}`);
      });

      monitor.on('stopped', () => {
        console.log('\n✓ Monitor stopped');
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', async () => {
        console.log('\n\nStopping monitor...');
        monitor.stop();
        await client.disconnect();
        process.exit(0);
      });

      // Start monitoring (init happens inside start())
      await monitor.start();

      console.log('Monitoring for zone/area changes... (Ctrl+C to stop)\n');

    } else if (command === 'arm') {
      // Parse arguments: arm [area] [type] [--force]
      // Examples: arm 1, arm 1 full, arm 1 part1 --force
      let areaNum = 1;
      let setType = 'full';
      // Check allArgs (original argv) for --force since args has -- filtered out
      const force = allArgs.includes('--force');

      // args already has -- filtered out, use directly
      const posArgs = args;

      // Check if first arg is a number (area)
      if (posArgs[1] && !isNaN(parseInt(posArgs[1]))) {
        areaNum = parseInt(posArgs[1]);
        if (posArgs[2] && ['full', 'part1', 'part2'].includes(posArgs[2])) {
          setType = posArgs[2];
        }
      } else if (posArgs[1] && ['full', 'part1', 'part2'].includes(posArgs[1])) {
        // First arg is type, use default area 1
        setType = posArgs[1];
      }

      console.log(`\nArming area ${areaNum} (${setType}${force ? ', force' : ''})...`);
      try {
        await client.armArea(areaNum, setType, force);
        console.log(`✓ Area ${areaNum} armed successfully`);
      } catch (err) {
        if (err instanceof AritechError) {
          console.log(`✗ Arm failed: ${err.message}`);
          if (err.status !== undefined) {
            console.log(`  Status: 0x${err.status.toString(16).padStart(4, '0')}`);
          }
          if (err.details?.faults?.length > 0) {
            console.log(`  Faults: ${err.details.faults.length} zone(s)`);
          }
          if (err.details?.activeZones?.length > 0) {
            console.log(`  Active zones: ${err.details.activeZones.length} zone(s)`);
          }
          if (err.details?.inhibitedZones?.length > 0) {
            console.log(`  Inhibited zones: ${err.details.inhibitedZones.length} zone(s)`);
          }
          if (!force) {
            console.log('  Use --force to arm anyway');
          }
        } else {
          throw err;
        }
      }
    } else if (command === 'disarm') {
      const areaNum = parseInt(args[1]) || 1;  // Default to area 1
      console.log(`\nDisarming area ${areaNum}...`);
      try {
        await client.disarmArea(areaNum);
        console.log(`✓ Area ${areaNum} disarmed successfully`);
      } catch (err) {
        if (err instanceof AritechError) {
          console.log(`✗ Disarm failed: ${err.message}`);
          if (err.status !== undefined) {
            console.log(`  Status: 0x${err.status.toString(16).padStart(4, '0')}`);
          }
        } else {
          throw err;
        }
      }
    } else if (command === 'zones') {
      console.log('\nQuerying zone names...');
      const zoneNames = await client.getZoneNames();
      console.log(`Found ${zoneNames.length} zones\n`);

      if (zoneNames.length > 0) {
        console.log('Querying zone states...');
        const zoneStates = await client.getZoneStates(zoneNames);

        // Merge names with states
        const zones = zoneNames.map(zoneName => {
          const zoneState = zoneStates.find(s => s.zone === zoneName.number);
          return {
            id: zoneName.number,
            name: zoneName.name,
            state: zoneState?.state || null
          };
        });

        console.log('\nZones:');
        zones.forEach(zone => {
          const s = zone.state;
          if (!s) {
            console.log(`  ⚫ Zone ${zone.id}: ${zone.name}`);
            console.log(`     State: unknown`);
            return;
          }

          // Determine icon and description
          let icon = '⚫';
          let stateDesc = 'Normal';

          if (s.isAlarming) { icon = '🔴'; stateDesc = 'Alarm'; }
          else if (s.isIsolated) { icon = '🟡'; stateDesc = 'Isolated'; }
          else if (s.isInhibited) { icon = '🟡'; stateDesc = 'Inhibited'; }
          else if (s.isTampered) { icon = '🟡'; stateDesc = 'Tamper'; }
          else if (s.hasFault) { icon = '🟡'; stateDesc = 'Fault'; }
          else if (s.isActive) { icon = '🟢'; stateDesc = 'Active'; }
          else if (s.isSet) { icon = '⚫'; stateDesc = 'Armed'; }

          console.log(`  ${icon} Zone ${zone.id}: ${zone.name}`);
          console.log(`     State: ${stateDesc}`);

          // Show all true flags dynamically
          const activeFlags = Object.entries(s)
            .filter(([key, value]) => value === true && !key.startsWith('raw'))
            .map(([key]) => key);

          console.log(`     Flags: ${activeFlags.join(', ') || 'none'}`);
        });

        if (process.env.LOG_LEVEL === 'debug') {
          console.log('\nDetailed zone data:');
          console.log(JSON.stringify(zones, null, 2));
        }
      } else {
        console.log('No zones found on this panel.');
      }
    } else if (command === 'areas') {
      console.log('\nQuerying area names...');
      const areaNames = await client.getAreaNames();
      console.log(`Found ${areaNames.length} areas\n`);

      if (areaNames.length > 0) {
        console.log('Querying area states...');
        const areaStates = await client.getAreaStates(areaNames);

        // Merge names with states
        const areas = areaNames.map(areaName => {
          const areaState = areaStates.find(s => s.area === areaName.number);
          return {
            id: areaName.number,
            name: areaName.name,
            state: areaState?.state || null
          };
        });

        console.log('\nAreas:');
        areas.forEach(area => {
          const s = area.state;
          if (!s) {
            console.log(`  ⚫ Area ${area.id}: ${area.name}`);
            console.log(`     State: unknown`);
            return;
          }

          // Determine icon and description
          let icon = '⚫';
          let stateDesc = 'Unknown';

          if (s.hasFire) { icon = '🔥'; stateDesc = 'Fire Alarm'; }
          else if (s.hasPanic) { icon = '🚨'; stateDesc = 'Panic Alarm'; }
          else if (s.hasMedical) { icon = '🏥'; stateDesc = 'Medical Alarm'; }
          else if (s.isAlarming) { icon = '🔴'; stateDesc = 'Alarm'; }
          else if (s.isFullSet) { icon = '🟢'; stateDesc = 'Armed (Full)'; }
          else if (s.isPartiallySet) { icon = '🟢'; stateDesc = 'Armed (Part 1)'; }
          else if (s.isPartiallySet2) { icon = '🟢'; stateDesc = 'Armed (Part 2)'; }
          else if (s.isExiting) { icon = '🟡'; stateDesc = 'Exiting'; }
          else if (s.isEntering) { icon = '🟡'; stateDesc = 'Entering'; }
          else if (s.isTampered) { icon = '🟡'; stateDesc = 'Tamper'; }
          else if (s.hasTechnical) { icon = '🔧'; stateDesc = 'Technical Fault'; }
          else if (s.isUnset && s.isReadyToArm) { icon = '⚫'; stateDesc = 'Disarmed (Ready)'; }
          else if (s.isUnset) { icon = '⚫'; stateDesc = 'Disarmed'; }

          console.log(`  ${icon} Area ${area.id}: ${area.name}`);
          console.log(`     State: ${stateDesc}`);

          // Show all true flags dynamically
          const activeFlags = Object.entries(s)
            .filter(([key, value]) => value === true && !key.startsWith('raw'))
            .map(([key]) => key);

          console.log(`     Flags: ${activeFlags.join(', ') || 'none'}`);
        });

        if (process.env.LOG_LEVEL === 'debug') {
          console.log('\nDetailed area data:');
          console.log(JSON.stringify(areas, null, 2));
        }
      } else {
        console.log('No areas found on this panel.');
      }

    } else if (command === 'inhibit') {
      const zoneNum = parseInt(args[1]);
      if (!zoneNum || zoneNum < 1) {
        console.log('Usage: node aritech-cli.js inhibit <zone_number>');
        console.log('Example: node aritech-cli.js inhibit 12');
      } else {
        console.log(`\nInhibiting zone ${zoneNum}...`);
        try {
          await client.inhibitZone(zoneNum);
          console.log(`✓ Zone ${zoneNum} inhibited successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to inhibit zone ${zoneNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else if (command === 'uninhibit') {
      const zoneNum = parseInt(args[1]);
      if (!zoneNum || zoneNum < 1) {
        console.log('Usage: node aritech-cli.js uninhibit <zone_number>');
        console.log('Example: node aritech-cli.js uninhibit 12');
      } else {
        console.log(`\nUninhibiting zone ${zoneNum}...`);
        try {
          await client.uninhibitZone(zoneNum);
          console.log(`✓ Zone ${zoneNum} uninhibited successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to uninhibit zone ${zoneNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else if (command === 'eventLog') {
      // Read event log as a stream
      const maxEvents = parseInt(args[1]) || 50;  // Default to 50 events
      console.log(`\nReading up to ${maxEvents} events from panel log...\n`);

      let count = 0;
      for await (const event of client.readEventLog(maxEvents)) {
        count++;
        // Format the event for display
        const time = event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown time';
        const category = event.category || 'Unknown';
        const name = event.name || 'Unknown event';
        const entity = `${event.entity?.type} ${event.entity?.id}: ${event.entity?.description}`;
        const area = event.area?.id ? `Area ${event.area.id}` : '';

        // Color-code by category
        let icon = '•';
        if (category.includes('Alarm')) icon = '🚨';
        else if (category.includes('Arm') || category.includes('Set')) icon = '🔒';
        else if (category.includes('Disarm') || category.includes('Unset')) icon = '🔓';
        else if (category.includes('Zone') || category.includes('Access')) icon = '📍';
        else if (category.includes('User')) icon = '👤';
        else if (category.includes('System')) icon = '⚙️';
        else if (category.includes('Trouble')) icon = '⚠️';

        console.log(`${icon} [${time}] ${name}`);
        if (entity || area) {
          console.log(`   ${entity}${area ? ` (${area})` : ''}`);
        }
        console.log('');
      }

      console.log(`\n✓ Displayed ${count} events`);
    } else if (command === 'outputs') {
      // Query both names and states, then merge them
      console.log('\nQuerying output names...');
      const outputs = await client.getOutputNames();
      console.log(`Found ${outputs.length} outputs\n`);

      if (outputs.length > 0) {
        console.log('Querying output states...');
        const states = await client.getOutputStates(outputs.map(o => o.number));

        // Merge names with states
        const merged = outputs.map(output => {
          const stateInfo = states.find(s => s.output === output.number);
          return {
            number: output.number,
            name: output.name,
            state: stateInfo ? stateInfo.state : null,
            rawHex: stateInfo ? stateInfo.rawHex : null
          };
        });

        console.log('\nOutputs:');
        merged.forEach(output => {
          const icon = output.state?.isOn ? '🟢' : '⚫';
          console.log(`  ${icon} Output ${output.number}: ${output.name}`);
          console.log(`     State: ${output.state?.toString() || 'unknown'}`);
        });

        if (process.env.LOG_LEVEL === 'debug') {
          console.log('\nDetailed output data:');
          console.log(JSON.stringify(merged, null, 2));
        }
      } else {
        console.log('No outputs found on this panel.');
      }
    } else if (command === 'activate') {
      const outputNum = parseInt(args[1]);
      if (!outputNum || outputNum < 1) {
        console.log('Usage: node aritech-cli.js activate <output_number>');
        console.log('Example: node aritech-cli.js activate 1');
      } else {
        console.log(`\nActivating output ${outputNum}...`);
        try {
          await client.activateOutput(outputNum);
          console.log(`✓ Output ${outputNum} activated successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to activate output ${outputNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else if (command === 'deactivate') {
      const outputNum = parseInt(args[1]);
      if (!outputNum || outputNum < 1) {
        console.log('Usage: node aritech-cli.js deactivate <output_number>');
        console.log('Example: node aritech-cli.js deactivate 1');
      } else {
        console.log(`\nDeactivating output ${outputNum}...`);
        try {
          await client.deactivateOutput(outputNum);
          console.log(`✓ Output ${outputNum} deactivated successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to deactivate output ${outputNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else if (command === 'triggers') {
      // Query both names and states, then merge them
      console.log('\nQuerying trigger names...');
      const triggers = await client.getTriggerNames();
      console.log(`Found ${triggers.length} triggers\n`);

      if (triggers.length > 0) {
        console.log('Querying trigger states...');
        const states = await client.getTriggerStates(triggers.map(t => t.number));

        // Merge names with states
        const merged = triggers.map(trigger => {
          const stateInfo = states.find(s => s.trigger === trigger.number);
          return {
            number: trigger.number,
            name: trigger.name,
            state: stateInfo ? stateInfo.state : null,
            rawHex: stateInfo ? stateInfo.rawHex : null
          };
        });

        console.log('\nTriggers:');
        merged.forEach(trigger => {
          // Icon: ⚫ inactive / 🟢 active
          const icon = trigger.state?.isActive ? '🟢' : '⚫';
          console.log(`  ${icon} Trigger ${trigger.number}: ${trigger.name}`);
          console.log(`     State: ${trigger.state?.toString() || 'unknown'}`);
        });

        if (process.env.LOG_LEVEL === 'debug') {
          console.log('\nDetailed trigger data:');
          console.log(JSON.stringify(merged, null, 2));
        }
      } else {
        console.log('No triggers found on this panel.');
      }
    } else if (command === 'trigger-activate') {
      const triggerNum = parseInt(args[1]);
      if (!triggerNum || triggerNum < 1) {
        console.log('Usage: node aritech-cli.js trigger-activate <trigger_number>');
        console.log('Example: node aritech-cli.js trigger-activate 1');
      } else {
        console.log(`\nActivating trigger ${triggerNum}...`);
        try {
          await client.activateTrigger(triggerNum);
          console.log(`✓ Trigger ${triggerNum} activated successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to activate trigger ${triggerNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else if (command === 'trigger-deactivate') {
      const triggerNum = parseInt(args[1]);
      if (!triggerNum || triggerNum < 1) {
        console.log('Usage: node aritech-cli.js trigger-deactivate <trigger_number>');
        console.log('Example: node aritech-cli.js trigger-deactivate 1');
      } else {
        console.log(`\nDeactivating trigger ${triggerNum}...`);
        try {
          await client.deactivateTrigger(triggerNum);
          console.log(`✓ Trigger ${triggerNum} deactivated successfully!`);
        } catch (err) {
          if (err instanceof AritechError) {
            console.log(`✗ Failed to deactivate trigger ${triggerNum}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    } else {
      console.log(`Unknown command: ${command}`);
      console.log('Run without arguments to see available commands.');
    }
  }

} catch (err) {
  console.error('\n!!! Error:', err.message);
  console.error(err.stack);
} finally {
  // Gracefully disconnect (unless monitoring, which handles its own cleanup)
  if (client.socket && !client.monitoringActive) {
    await client.disconnect();
  }
}


