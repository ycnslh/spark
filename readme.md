# NetArise - Wake-on-LAN Web Interface

A web application that allows you to remotely wake computers using Wake-on-LAN. It's designed to run in a Docker container on a Raspberry Pi and provides an easy way to wake your devices from your iPhone or any web browser.

## Features

- Responsive web interface accessible from any device
- Direct URL access for quick waking via bookmarks or iOS shortcuts
- Add and remove devices directly from the web interface
- Device list stored in a CSV file
- Easy iPhone shortcut integration
- Docker-based for simple deployment

## Prerequisites

- Raspberry Pi (model 3 or newer recommended)
- Docker and Docker Compose installed on the Raspberry Pi
- Local network configured to allow Wake-on-LAN magic packets
- Target computers configured for Wake-on-LAN in their BIOS/UEFI settings

## Installation

1. Clone this repository to your Raspberry Pi:
   ```bash
   git clone https://github.com/your-username/netarise.git
   cd netarise
   ```

2. Build and start the Docker container:
   ```bash
   docker-compose up -d
   ```

3. Access the web interface at `http://[raspberry-pi-ip]:8085`

## Usage

### Managing Devices

You can manage your devices in two ways:

1. **Web Interface**: Add or remove devices directly through the web interface.
2. **CSV File**: Edit the `devices.csv` file manually.

The file format is simple:
```csv
name,mac
Office PC,1a2b3c4d5e6f
Laptop,2a3b4c5d6e7f
```

### Waking Devices

There are two ways to wake your devices:

1. **Web Interface**: Visit the homepage and click the "Wake" button for the desired device.
2. **Direct URL**: Use a URL like `http://[raspberry-pi-ip]:8085/wake/[device-name]` to directly wake a specific device.

## iPhone Shortcuts Integration

One of the key features is the ability to create iPhone shortcuts that wake your computers with a single tap or voice command. Here's how to set it up:

### Creating an iPhone Shortcut

1. **Get the Direct Wake URL**:
   - Open the web interface on your iPhone
   - Under "Direct Links for Shortcuts", locate your device and copy its URL
   - The URL should look like: `http://192.168.1.100:8085/wake/Office%20PC`

2. **Create the Shortcut**:
   - Open the "Shortcuts" app on your iPhone
   - Tap the "+" button to create a new shortcut
   - Tap "Add Action"
   - Search for and select "Get Contents of URL"
   - Paste the URL you copied
   - Tap "Next" and give your shortcut a name (e.g., "Wake Office PC")
   - Optionally, add an icon by tapping the icon in the upper left
   - Tap "Done" to save the shortcut

3. **Add to Home Screen** (optional):
   - In the Shortcuts app, press and hold on your new shortcut
   - Select "Share"
   - Choose "Add to Home Screen"
   - Confirm to add it to your home screen

4. **Voice Activation** (optional):
   - You can activate your shortcut with Siri by saying "Hey Siri, Wake Office PC"
   - Or add a phrase when creating the shortcut by enabling "Show in Share Sheet"

### Adding to Widgets

For even quicker access, add your shortcuts to the iOS widgets:

1. From your home screen, swipe right to access the widget screen
2. Scroll down and tap "Edit"
3. Tap the "+" button in the top left
4. Find and select "Shortcuts"
5. Choose a widget size and tap "Add Widget"
6. Tap the widget to configure it
7. Select your Wake-on-LAN shortcuts to display

## Configuring Wake-on-LAN on Windows 11

For your Windows 11 computer to respond to Wake-on-LAN packets, you need to:

1. **Enable Wake-on-LAN in BIOS/UEFI**:
   - Restart your computer and enter BIOS/UEFI (usually F2, F10, DEL, or ESC key)
   - Look for "Wake-on-LAN", "Remote Wake Up", or similar in power management or network settings
   - Enable this option and save changes

2. **Configure the Network Adapter in Windows 11**:
   - Open Device Manager
   - Expand "Network adapters"
   - Right-click on your network adapter and select "Properties"
   - Go to the "Power Management" tab
   - Check "Allow this device to wake the computer"
   - Also check "Only allow a magic packet to wake the computer"
   - Go to the "Advanced" tab
   - Look for and configure these options (if available):
     - "Wake on Magic Packet" → Enabled
     - "Wake on pattern match" → Enabled
     - "Energy Efficient Ethernet" → Disabled

3. **Disable Fast Startup in Windows**:
   - Open Control Panel
   - Go to "System and Security" → "Power Options"
   - Click "Choose what the power button does"
   - Click "Change settings that are currently unavailable"
   - Uncheck "Turn on fast startup"
   - Click "Save changes"

## External Access (Optional)

To access your interface from outside your local network:

1. Set up port forwarding on your router
2. Use a dynamic DNS service like No-IP to have a domain name
3. Consider adding authentication to the application for security

## Troubleshooting

If a device doesn't wake up:
- Verify the MAC address is correct in the CSV file
- Make sure Wake-on-LAN is properly configured in the BIOS/UEFI
- Check that your router allows broadcast packets
- Test with another Wake-on-LAN tool to confirm the device responds

## Security Considerations

This application is designed for use on a private, trusted network. When exposing it to the internet:

- Add authentication
- Consider using HTTPS
- Restrict access using your router's firewall

## License

This project is licensed under the MIT License - see the LICENSE file for details.
