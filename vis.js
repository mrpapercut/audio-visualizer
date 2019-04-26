class Visualize {
    constructor(audioFile, canvas, btnPlay, btnStop) {
        this.canvas = canvas;
        this.canvasWidth = 512;
        this.canvasHeight = 256;
        this.canvas.style.background = '#000';
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        this.canvasContext = this.canvas.getContext('2d');

        this.audioFile = audioFile;
        this.loadedAudio = null;

        this.isLoaded = false;
        this.isPlaying = false;

        this.guessedBPM = 0;

        this.peakLength = 950;

        this.buttonPlay = btnPlay;
        this.buttonStop = btnStop;

        this.setup();
        this.attachEvents();
    }

    setup() {
        this.audioContext = new AudioContext();

        // Create source buffer
        this.srcNode = this.audioContext.createBufferSource();

        // Create lowpass filter
        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 3000;
        this.filter.gain.value = 25;

        // Create analyser
        this.analyserNode = this.audioContext.createAnalyser();

        // Create js processor
        this.jsNode = this.audioContext.createScriptProcessor(1024, 1, 1);

        // Get frequency data
        this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);

        this.srcNode.connect(this.audioContext.destination);
        this.srcNode.connect(this.analyserNode);
        this.srcNode.connect(this.filter);

        // Connect analyser to output
        this.analyserNode.connect(this.jsNode);
        this.jsNode.connect(this.audioContext.destination);

        // Connect filter to output
        // Comment line 55 and uncomment the following 2 lines to hear the filtered-output
        // this.jsNode.connect(this.filter);
        // this.filter.connect(this.audioContext.destination);

        this.jsNode.addEventListener('audioprocess', _ => {
            this.analyserNode.getByteFrequencyData(this.frequencyData);
            
            // This next line seems to impact performance quite a lot
            // cancelAnimationFrame(this.raf);
            this.raf = requestAnimationFrame(() => this.drawCanvas());
        });
    }

    attachEvents() {
        this.buttonPlay.addEventListener('click', e => this.play());
        this.buttonStop.addEventListener('click', e => this.stop());
    }

    loadAudio() {
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('GET', this.audioFile, true);
            request.responseType = 'arraybuffer';

            request.onload = () => {
                this.audioContext.decodeAudioData(request.response, buffer => {
                    this.loadedAudio = buffer;
                    resolve();
                });
            }

            request.send();
        });
    }

    play() {
        if (this.srcNode.buffer !== null) {
            this.setup();
        }

        this.loadAudio().then(_ => {
            this.srcNode.buffer = this.filter.buffer = this.loadedAudio;
            this.isPlaying = true;

            const channelData = this.filter.buffer.getChannelData(0);
            this.guessedBPM = this.calculateBPM(channelData);

            this.srcNode.start(0);
        });
    }

    calculateBPM(channelData) {
        let peaks;
        let threshold = 1,
            minThreshold = 0.7,
            minPeaks = 30;

        do {
            peaks = this.getPeaksAtThreshold(channelData, threshold);
            threshold -= 0.05;
        } while (peaks.length < minPeaks && threshold >= minThreshold);

        const intervals = this.countIntervalsBetweenNearbyPeaks(peaks);
        const groups = this.groupNeighborsByTempo(intervals, this.loadedAudio.sampleRate);
        const top = groups.sort((a, b) => b.count - a.count);

        return top.shift().tempo;
    }

    stop() {
        cancelAnimationFrame(this.raf);
        this.srcNode.stop();

        this.isPlaying = false;
    }

    drawCanvas() {
        this.clearCanvas();

        let r = 255;
        let g = 0;
        let b = 0;

        for (let i = 0; i < this.frequencyData.length; i += 2) {
            let f = this.frequencyData[i];
            if (r > 0 && i % 4 === 0) r--;
            if (g < 255) g++;
            else if (b < 255) b++;

            let ctx = this.canvasContext;

            ctx.font = "12px Arial";
            ctx.textBaseline = "top";
            ctx.textAlign = 'right';
            ctx.fillStyle = "white";

            ctx.strokeStyle = "black";
            ctx.lineWidth = 1;

            ctx.shadowColor = '#000';
            ctx.shadowBlur    = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.fillText(`BPM: ${this.guessedBPM}`, this.canvasWidth - 10, 10);

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${i % 4 === 0 ? 0.8 : 0.6})`;
            ctx.fillRect(i / 2, this.canvasHeight - (f / 2), 1, this.canvasHeight);
        }
    }

    clearCanvas() {
        this.canvasContext.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // Function to identify peaks
    getPeaksAtThreshold(data, threshold) {
        const peaksArray = [];

        for (let i = 0; i < data.length;) {
            if (data[i] > threshold) {
                peaksArray.push(i);
                // Skip forward ~ 1/4s to get past this peak.
                i += this.peakLength;
            }
            i++;
        }

        return peaksArray;
    }

    // Function used to return a histogram of peak intervals
    countIntervalsBetweenNearbyPeaks(peaks) {
        const intervalCounts = [];

        peaks.forEach((peak, index) => {
            for (let i = 0; i < 10; i++) {
                const interval = peaks[index + i] - peak;

                const foundInterval = intervalCounts.some(intervalCount => {
                    if (intervalCount.interval === interval) {
                        return intervalCount.count++;
                    }
                });

                if (!foundInterval) {
                    intervalCounts.push({
                        interval: interval,
                        count: 1
                    });
                }
            }
        });

        return intervalCounts;
    }

    // Function used to return a histogram of tempo candidates.
    groupNeighborsByTempo(intervalCounts, sampleRate) {
        const tempoCounts = [];

        intervalCounts.forEach((intervalCount, i) => {
            if (intervalCount.interval !== 0) {
                // Convert an interval to tempo
                let theoreticalTempo = Math.round(60 / (intervalCount.interval / sampleRate));

                const foundTempo = tempoCounts.some(tempoCount => {
                    if (tempoCount.tempo === theoreticalTempo) {
                        return tempoCount.count += intervalCount.count;
                    }
                });

                if (!foundTempo) {
                    tempoCounts.push({
                        tempo: theoreticalTempo,
                        count: intervalCount.count
                    });
                }
            }
        });

        return tempoCounts;
    }
}
