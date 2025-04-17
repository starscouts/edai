const chalk = require('chalk');
const fs = require('fs');
const prompts = require('prompts');
const child_process = require("child_process");
const path = require("path");
const {tmpdir} = require("os");
const crypto = require("crypto");
const version = "1.0";

console.log(chalk.gray("EDAI v" + version));
console.log(chalk.gray("(c) Equestria.dev"));
console.log("");

let missing = [];

try {
    child_process.execFileSync("mplayer", [ "--help" ], { stdio: "ignore" });
} catch (e) {
    if (e.status !== 1) missing.push("mplayer");
}

try {
    child_process.execFileSync("ffmpeg", [ "--help" ], { stdio: "ignore" });
} catch (e) {
    missing.push("ffmpeg");
}

if (missing.length > 0) {
    console.log("Cannot continue because the following " + (missing.length > 1 ? "commands are" : "command is") + " missing: " + missing.join(", ") + ". You can usually install " + (missing.length > 1 ? "them" : "it") + " using your system's package manager.");
    process.exit(2);
}

async function openFile() {
    return await prompts({
        type: 'text',
        name: 'value',
        message: 'Enter the path to an EDAI or other audio file:',
        validate: (value) => {
            try {
                if (fs.existsSync(value)) {
                    return true;
                } else {
                    return "File not found";
                }
            } catch (e) {
                return "Error while checking if the file exists";
            }
        }
    });
}

function changeExtension(file, ext) {
    let folder = path.dirname(file);
    let base = path.basename(file, path.extname(file));
    return folder + path.sep + base + "." + ext;
}

function calculateBitRate(bits) {
    if (bits > 1000) {
        return Math.round(bits / 1000) + " kbps";
    } else {
        return bits + " bps";
    }
}

function buildFFmpegArgs(temp) {
    let args = [
        "-i",
        global.openFileName
    ];

    if (global.config['spatial']) {
        args.push(...[ "-af", "apulsator=hz=0.015" ]);
        args.push(...[ "-af", "aecho=1.0:0.7:20:0.5" ]);
    }

    return [...args, temp];
}

function getDuration(time) {
    let hours = Math.floor(time / 3600);
    let minutes = Math.floor((time - hours * 3600) / 60);
    let seconds = Math.floor(time - hours * 3600 - minutes * 60);

    return (
        "00".substring(0, 2 - hours.toString().length) + hours.toString() + ":" +
        "00".substring(0, 2 - minutes.toString().length) + minutes.toString() + ":" +
        "00".substring(0, 2 - seconds.toString().length) + seconds.toString()
    )
}

function saveFile() {
    global.config['metadata'] = {
        lastSaveVersion: version,
        lastSaveDate: new Date().getTime()
    }

    let data = Buffer.from(JSON.stringify(global.config)).toString("base64");

    if (data.length > 40960) {
        console.log("Unable to save file because it is too large for EDAI. Please remove some settings and try again. Your settings are " + (data.length - 40960) + " too large to be saved.");
        process.exit(2);
    }

    global.openFileBuffer.write("|" + data + "|", 0x1000);
    fs.writeFileSync(global.openFileName, global.openFileBuffer);
}

async function mainMenu() {
    if (global.config['effects'] === undefined) global.config['effects'] = [];
    if (global.config['splits'] === undefined) global.config['splits'] = [];
    if (global.config['spatial'] === undefined) global.config['spatial'] = false;
    if (global.config['conversion'] === undefined) global.config['conversion'] = null;

    let probe = JSON.parse(child_process.execFileSync("ffprobe", [ "-i", global.openFileName, "-v", "quiet", "-print_format", "json", "-show_streams" ]).toString().trim())["streams"][0];
    let description = probe['sample_rate'] + " Hz, " + probe['bits_per_sample'] + "-bit, " + (probe['channels'] === 2 ? "Stereo" : (probe['channels'] === 1 ? "Mono" : probe['channels'] + " channels")) + ", " + calculateBitRate(parseInt(probe['bit_rate'])) + ", " + getDuration(parseFloat(probe['duration']));

    const response = await prompts([
        {
            type: 'select',
            name: 'select',
            message: description,
            warn: '',
            hint: '',
            choices: [
                { title: chalk.red("Quit"), value: 'quit' },
                { title: chalk.cyan("Play audio file"), value: 'play' },
                { title: chalk.white('Effects'), value: 'effects' },
                { title: chalk.white('Splitter'), value: 'splitter' },
                { title: chalk.white('Spatial audio'), value: 'spatial' },
                { title: chalk.white('Converter'), value: 'converter' },
                { title: chalk.cyan('About this file'), value: 'about' }
            ],
        }
    ]);

    if (!response['select']) {
        process.exit(1);
    }

    switch (response['select']) {
        case "quit":
            saveFile();
            process.exit();
            break;

        case "about":
            console.log(chalk.gray("---------------------------------"));
            console.log(chalk.yellow(require('path').resolve(global.openFileName)));
            console.log(chalk.yellow(description));
            console.log("  - " + chalk.magenta("EDAI Spatial Surround: ") + (global.config['spatial'] ? chalk.green("ON") : chalk.red("OFF")));
            console.log("  - " + chalk.magenta("Effects: ") + global.config['effects'].length);
            console.log("  - " + chalk.magenta("Splits: ") + global.config['splits'].length + (global.config['splits'].length === 0 ? " (default)" : ""));
            console.log("  - " + chalk.magenta("Format: ") + (global.config['conversion'] ? "?" : "(default)"));
            console.log(chalk.gray("---------------------------------"));
            break;

        case "spatial":
            while (await spatialMenu() === true) {}
            break;

        case "play":
            console.log("Rendering file... Please wait.");
            let path = tmpdir() + "/edai-" + crypto.randomBytes(8).toString("hex") + ".wav";

            try {
                child_process.execFileSync("ffmpeg", buildFFmpegArgs(path), { stdio: "ignore" });
            } catch (e) {
                console.log("An error occurred while rendering the file. Make sure all of your settings are configured properly and try again.");
                return;
            }

            process.stdout.moveCursor(0, -1); process.stdout.clearLine(); process.stdout.moveCursor(0, 1);
            child_process.execFileSync("mplayer", [ "-msgcolor", "-msglevel", "all=5:global=0:cplayer=0:gplayer=0:vo=0:ao=0:demuxer=0:ds=0:demux=0:header=0:avsync=0:autoq=0:cfgparser=0:decaudio=0:decvideo=0:seek=0:win32=0:open=0:dvd=0:parsees=0:lirc=0:stream=0:cache=0:mencoder=0:xacodec=0:tv=0:osdep=0:spudec=0:playtree=0:input=0:vfilter=0:osd=0:network=0:cpudetect=0:codeccfg=0", "-nosub", "-noautosub", path ], { stdio: "inherit" });
            fs.unlinkSync(path);

            process.stdout.clearLine();
            process.stdout.moveCursor(0, -1);
            break;
    }
}

async function spatialMenu() {
    const response = await prompts([
        {
            type: 'select',
            name: 'select',
            message: "Spatial audio",
            warn: '',
            hint: '',
            choices: [
                { title: chalk.red("Back"), value: 'back' },
                { title: chalk.white("[") + (global.config['spatial'] ? chalk.green("ON") : chalk.red("OFF")) + chalk.white("] EDAI Spatial Surround"), value: 'ess' }
            ],
        }
    ]);

    if (!response['select']) {
        process.exit(1);
    }

    switch (response['select']) {
        case "back":
            return false;

        case "ess":
            process.stdout.moveCursor(0, -1);
            process.stdout.clearLine(null);
            global.config['spatial'] = !global.config['spatial'];
            return true;
    }
}

(async () => {
    let file;

    if (process.argv[2]) {
        try {
            if (fs.existsSync(process.argv[2])) {
                file = {
                    value: process.argv[2]
                }
            } else {
                console.log("File not found");
                process.exit(2);
            }
        } catch (e) {
            console.log("Error while checking if the file exists");
            process.exit(2);
        }
    } else {
        file = await openFile();
    }

    if (file.value) {
        let data = fs.readFileSync(file.value);

        let isValid = false;
        global.config = {};

        if (data.subarray(0x100, 0x110).toString().trim().replaceAll("\x00", "") === "EDAI-AudioFile" && data.subarray(0x0, 0x4).toString().trim().replaceAll("\x00", "") === "RIFF" && data.subarray(0x8, 0xC).toString().trim().replaceAll("\x00", "") === "WAVE") {
            isValid = true;
        }

        if (isValid) {
            let lastChar = "";
            let b64 = "";
            let pos = 0x1001;

            if (data.subarray(0x1000, 0x1001).toString() !== "\x00") {
                while (lastChar !== "|") {
                    lastChar = data.subarray(pos, pos + 1).toString();
                    if (lastChar !== "|") b64 += lastChar;
                    pos++;
                }

                try {
                    let json = Buffer.from(b64, "base64").toString();
                    global.config = JSON.parse(json);
                } catch (e) {}
            }

            global.openFileBuffer = data;
            global.openFileName = file.value;
        } else {
            console.log("File is not an EDAI file, converting it to EDAI...");

            //console.log("Exporting as WAV, this may take a while.");
            let tempFile = changeExtension(file.value, "edaitmp");
            let finalFile = changeExtension(file.value, "edai");

            try {
                child_process.execFileSync("ffmpeg", [ "-y", "-i", file.value, "-f", "wav", tempFile ], { stdio: "ignore" });
            } catch (e) {
                try { fs.unlinkSync(tempFile); } catch (e) {}
                console.log("Failed to decode file using ffmpeg, make sure it is a valid audio file.");
            }

            //console.log("Opening generated file...");
            let data = fs.readFileSync(tempFile);

            //console.log("Adding EDAI header...");
            data.write("\x00EDAI-AudioFile\x00", 0x100);

            //console.log("Adding initial EDAI configuration...");
            data.write("|e30K|", 0x1000);

            //console.log("Writing...");
            fs.writeFileSync(finalFile, data);
            fs.unlinkSync(tempFile);

            console.log("Conversion completed.");
            global.openFileBuffer = data;
            global.openFileName = finalFile;
        }
    } else {
        process.exit(1);
    }

    while (true) {
        await mainMenu();
    }
})();