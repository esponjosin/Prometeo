# Prometeo

Prometeo is a versatile download manager library for Node.js that enables efficient parallel downloading of files, making it a valuable tool for tasks like batch downloading large sets of files. It offers speed control, automatic retries, and the ability to resume interrupted downloads.
<br/>

## Installation
You can install Prometeo using npm:

```bash
npm install prometeo
```
<br/>

# Usage
Here's a basic example of how to use Prometeo to download a file:

```javascript
const Manager = require('prometeo');

const prometeo = new Manager({
  connections: 4, // Number of concurrent download connections (optional)
  tempdir: '/path/to/temp/folder', // Temporary storage directory (optional)
  userAgent: 'Your User Agent', // User agent for HTTP requests (optional)
  speedLimit: 10, // Speed limit in Mbps (optional)
});

// Start a download
const download = prometeo.download({
  url: 'https://example.com/largefile.zip',
  path: '/path/to/save/',
  filename: 'save.zip' //(optional)
});

download.on('start', () => {
  console.log('Download started');
});

download.on('progress', ({speed, progress, estimated}) => {
  console.log(`Download progress: ${progress}% with a speed of ${speed} (estimated: ${estimated / 1000} seconds)`);
});

download.on('finish', () => {
  console.log('Download finished');
});

setTimeout(() => {
    prometeo.setSpeed(5)
}, 5000) //Change the limit speed to 5 Mbps before 5 seconds

let filePath = await download.start();
console.log(`file saved at: ${filePath}`)
```

For more detailed examples and options, please refer to the documentation.

# Features
- Concurrent downloading with adjustable connection count.
- Speed control to limit download speed.
- Automatic retry of failed downloads.
- Resume interrupted downloads.
- Event-driven design with progress and error handling.
<br/>
<br/>

# DISCLAIMER
This project is still in testing phase, it is not recommended for production use.
<br/>
<br/>

# Contributing
Contributions are welcome! Please follow our contribution guidelines to get started.
<br/>
<br/>

# License
This project is licensed under the MIT License - see the [LICENSE](https://github.com/esponjosin/Prometeo/blob/main/LICENSE) file for details.