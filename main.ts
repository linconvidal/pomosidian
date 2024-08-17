import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface PomosidianSettings {
    mySetting: string;
}

const DEFAULT_SETTINGS: PomosidianSettings = {
    mySetting: 'default'
}

export default class Pomosidian extends Plugin {
    settings: PomosidianSettings;
    private timer: NodeJS.Timeout | null = null;
    private startTime: Date | null = null;
    private totalTime: number = 0;
    private statusBarItemEl: HTMLElement;

    async onload() {
        await this.loadSettings();

        // Create a ribbon icon for starting/stopping the timer
        const ribbonIconEl = this.addRibbonIcon('timer', 'Pomosidian', (evt: MouseEvent) => {
            this.toggleTimer();
        });
        ribbonIconEl.addClass('my-plugin-ribbon-class');

        // Create a status bar item
        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('🕑'); // Initial icon (play icon)
        this.statusBarItemEl.setAttr('title', 'Start timer');

        // Update the tooltip based on the current status
        this.updateTooltip();

        // Add commands for starting and stopping the timer
        this.addCommand({
            id: 'start-timer',
            name: 'Start Timer',
            callback: () => this.startTimer(),
        });

        this.addCommand({
            id: 'stop-timer',
            name: 'Stop Timer',
            callback: () => this.stopTimer(),
        });
    }

    toggleTimer() {
        if (this.timer) {
            this.stopTimer();
        } else {
            this.startTimer();
        }
    }

    startTimer() {
		if (this.timer) {
			new Notice("Timer is already running.");
			return;
		}
	
		this.startTime = new Date();
		this.timer = setInterval(() => {
			const elapsedTime = this.formatTime((new Date().getTime() - this.startTime!.getTime()) / 1000);
			const activeFile = this.app.workspace.getActiveFile();
			const fileName = activeFile ? activeFile.basename : "Unknown page";
			this.statusBarItemEl.setText(`⏸️ ${elapsedTime}`); // Display the elapsed time in the status bar
			this.statusBarItemEl.setAttr('title', `Stop timer for ${fileName} (Running for ${elapsedTime})`);
		}, 1000); // Update every second
	
		const activeFile = this.app.workspace.getActiveFile();
		const fileName = activeFile ? activeFile.basename : "Unknown page";
		new Notice(`Timer started for ${fileName}.`);
	}
	
	async stopTimer() {
		if (!this.timer) {
			new Notice("No timer is running.");
			return;
		}
	
		clearInterval(this.timer);
		this.timer = null;
	
		const endTime = new Date();
		const timeSpent = (endTime.getTime() - this.startTime!.getTime()) / 1000; // in seconds
		this.totalTime += timeSpent;
	
		const activeFile = this.app.workspace.getActiveFile();
		const fileName = activeFile ? activeFile.basename : "Unknown page";
		await this.logTimeSpent(this.startTime!, endTime);
		this.statusBarItemEl.setText('🕑'); // Change icon back to 'play'
		this.statusBarItemEl.setAttr('title', `Start timer for ${fileName}`);
		new Notice(`Timer stopped for ${fileName}. Total time: ${this.formatTime(timeSpent)}`);
	}


	formatTime(seconds: number, total = false): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
	
		if (hours > 0) {
			return minutes > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}m` : `${hours}h`;
		} else if (minutes > 0 || total) {
			return `${minutes}m`;
		}
		return '';
	}

    async logTimeSpent(startTime: Date, endTime: Date) {
		const startIcon = "⏱️"; // Icon for start
		const stopIcon = "✅"; // Icon for stop
	
		// Calculate the duration for this session
		const duration = this.formatTime((endTime.getTime() - startTime.getTime()) / 1000);
	
		let logEntry = `  ${stopIcon} Task stopped - _${endTime.toLocaleTimeString()} on ${endTime.toLocaleDateString()}_`;
		if (duration) {
			logEntry += ` (${duration})`;
		}
		logEntry += `\n  ${startIcon} Task started - _${startTime.toLocaleTimeString()} on ${startTime.toLocaleDateString()}_\n`;
	
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const content = await this.app.vault.read(activeFile);
	
			// Regex to find the existing pomodoro_log block
			const logBlockRegex = /pomodoro_log: \|\-\n([\s\S]*?)\n/m;
			const match = content.match(logBlockRegex);
	
			let existingLogEntries = [];
			if (match) {
				// Extract and parse existing log entries
				existingLogEntries = match[1].trim().split('\n').filter(entry => entry.trim() !== '');
			}
	
			// Append the new entry at the beginning to maintain chronological order
			existingLogEntries.unshift(logEntry.trim());
	
			// Sort the entries chronologically
			existingLogEntries.sort((a, b) => {
				const dateA = new Date(a.match(/on (.*)/)![1]);
				const dateB = new Date(b.match(/on (.*)/)![1]);
				return dateA.getTime() - dateB.getTime();
			});
	
			// Join the sorted entries into a single string with correct indentation
			const updatedLog = existingLogEntries.map(entry => `  ${entry}`).join('\n');
	
			// Calculate the total time spent by parsing the log entries
			const totalTimeSpentSeconds = this.calculateTotalTime(existingLogEntries);
			const totalTimeSpent = this.formatTime(totalTimeSpentSeconds, true);
	
			// Update the time_spent property or add it if it doesn't exist
			const timeSpentRegex = /time_spent: .*/m;
			let updatedContent;
			if (timeSpentRegex.test(content)) {
				updatedContent = content.replace(timeSpentRegex, `time_spent: ${totalTimeSpent}`);
			} else {
				updatedContent = content.replace(/---\n([\s\S]*?)---/m, `---\n$1time_spent: ${totalTimeSpent}\n---`);
			}
	
			// Replace or append the pomodoro_log property within the properties block
			updatedContent = updatedContent.replace(logBlockRegex, `pomodoro_log: |-\n${updatedLog}\n`) ||
				updatedContent.replace(/---\n([\s\S]*?)---/m, `---\n$1pomodoro_log: |-\n${updatedLog}\n---`) ||
				`---\npomodoro_log: |-\n${updatedLog}\n---\n\n${content}`;
	
			// Write the updated content back to the file
			await this.app.vault.modify(activeFile, updatedContent);
		}
	}
	
	calculateTotalTime(logEntries: string[]): number {
		let totalSeconds = 0;
	
		for (let i = 0; i < logEntries.length; i += 2) {
			const stopEntry = logEntries[i];
			const startEntry = logEntries[i + 1];
	
			const stopTimeMatch = stopEntry.match(/on (.*)/);
			const startTimeMatch = startEntry?.match(/on (.*)/); // Use optional chaining to handle edge cases
	
			if (stopTimeMatch && startTimeMatch) {
				const stopTime = new Date(stopTimeMatch[1]);
				const startTime = new Date(startTimeMatch[1]);
	
				// Add the duration between start and stop times
				totalSeconds += (stopTime.getTime() - startTime.getTime()) / 1000;
			}
		}
	
		return totalSeconds;
	}
	

    async getPomodoroLog(): Promise<string> {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const content = await this.app.vault.read(activeFile); // Await the read operation
            const pomodoroLogMatch = content.match(/pomodoro_log: \|\-[\s\S]*?(?=\n---)/m);
            return pomodoroLogMatch ? `\n\n${pomodoroLogMatch[0]}` : '';
        }
        return '';
    }


    updateTooltip() {
        // Update the tooltip based on the timer status
        if (this.timer) {
            this.statusBarItemEl.setAttr('title', 'Stop timer');
        } else {
            this.statusBarItemEl.setAttr('title', 'Start timer');
        }
    }

    onunload() {
        if (this.timer) {
            clearInterval(this.timer);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}