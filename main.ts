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
	private timerFileName: string | null = null;

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
		const activeFile = this.app.workspace.getActiveFile();
		this.timerFileName = activeFile ? activeFile.basename : "Unknown page"; // Store the file name
	
		this.timer = setInterval(() => {
			const elapsedTime = this.formatTime((new Date().getTime() - this.startTime!.getTime()) / 1000);
			this.statusBarItemEl.setText(`⏸️ ${elapsedTime} - ${this.timerFileName}`); // Use stored file name
			this.statusBarItemEl.setAttr('title', `Stop timer for ${this.timerFileName} (Running for ${elapsedTime})`);
		}, 1000); // Update every second
	
		new Notice(`Timer started for ${this.timerFileName}.`);
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
	
		// Use the stored timerFileName instead of the active file
		const fileName = this.timerFileName || "Unknown page";
		await this.logTimeSpent(this.startTime!, endTime);
		this.statusBarItemEl.setText('🕑'); // Change icon back to 'play'
		this.statusBarItemEl.setAttr('title', `Start timer for ${fileName}`);
		new Notice(`Timer stopped for ${fileName}. Total time: ${this.formatTime(timeSpent)}`);
	}

	async logTimeSpent(startTime: Date, endTime: Date) {
		// Format the date and time manually to match the local timezone
		const formatDateTime = (date: Date) => {
			const year = date.getFullYear();
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const hours = date.getHours().toString().padStart(2, '0');
			const minutes = date.getMinutes().toString().padStart(2, '0');
			const seconds = date.getSeconds().toString().padStart(2, '0');
			return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
		};
	
		const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
		const durationFormatted = this.formatTime(durationSeconds); // Use the human-friendly format
	
		// Construct the log entry as a single atomic line
		const logEntry = ` ⏱️ ${formatDateTime(startTime)} - ${formatDateTime(endTime)} (${durationFormatted})`;
	
		// Find the file that the timer started on using this.timerFileName
		const allFiles = this.app.vault.getFiles();
		const targetFile = allFiles.find(file => file.basename === this.timerFileName);
	
		if (targetFile) {
			let content = await this.app.vault.read(targetFile);
	
			// Check if the file contains the front matter block
			const frontMatterRegex = /^---\n([\s\S]*?)\n---/m;
			const hasFrontMatter = frontMatterRegex.test(content);
	
			let updatedFrontMatter = "";
			if (hasFrontMatter) {
				// Extract the existing front matter
				const frontMatterMatch = content.match(frontMatterRegex);
				const existingFrontMatter = frontMatterMatch ? frontMatterMatch[1] : '';
	
				// Prepare to update time_spent and pomosidian_log
				const timeSpentRegex = /time_spent: .*/m;
				const logBlockRegex = /pomosidian_log: \|-\n([\s\S]*)/m;
	
				// Update or add time_spent
				const totalTimeSpentSeconds = this.calculateTotalTime([logEntry]);
				const totalTimeSpent = this.formatTime(totalTimeSpentSeconds);
	
				if (timeSpentRegex.test(existingFrontMatter)) {
					updatedFrontMatter = existingFrontMatter.replace(timeSpentRegex, `time_spent: ${totalTimeSpent}`);
				} else {
					updatedFrontMatter = existingFrontMatter + `\ntime_spent: ${totalTimeSpent}`;
				}
	
				// Update or add pomosidian_log
				if (logBlockRegex.test(existingFrontMatter)) {
					updatedFrontMatter = updatedFrontMatter.replace(logBlockRegex, `pomosidian_log: |-\n${logEntry}\n$1`);
				} else {
					updatedFrontMatter = updatedFrontMatter + `\npomosidian_log: |-\n${logEntry}`;
				}
	
				// Reconstruct the content
				content = content.replace(frontMatterRegex, `---\n${updatedFrontMatter.trim()}\n---`);
			} else {
				// Create the front matter block if it doesn't exist
				updatedFrontMatter = `time_spent: ${durationFormatted}\npomosidian_log: |-\n${logEntry}`;
				content = `---\n${updatedFrontMatter}\n---\n\n${content.trim()}`;
			}
	
			// Save the modified content back to the file
			await this.app.vault.modify(targetFile, content);
		} else {
			new Notice(`Could not find the file where the timer started (${this.timerFileName}).`);
		}
	}
	
	calculateTotalTime(logEntries: string[]): number {
		console.log("Calculating total time from log entries: ", logEntries);
		let totalSeconds = 0;
	
		logEntries.forEach(entry => {
			// Extract the start and end times from the log entry
			const timeMatch = entry.match(/⏱️ (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
			if (timeMatch) {
				const startTime = new Date(timeMatch[1]).getTime();
				const endTime = new Date(timeMatch[2]).getTime();
	
				// Calculate the duration in seconds
				const duration = (endTime - startTime) / 1000;
				totalSeconds += duration;
			}
		});
	
		console.log("Final total time spent in seconds: ", totalSeconds);
		return totalSeconds;
	}
	
	formatTime(seconds: number): string {
		seconds = Math.floor(seconds);
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const remainingSeconds = seconds % 60;
	
		if (hours > 0 && minutes > 0) {
			return `${hours}h${minutes}m`;
		} else if (hours > 0) {
			return `${hours}h`;
		} else if (minutes > 0 && remainingSeconds > 0) {
			return `${minutes}m${remainingSeconds}s`;
		} else if (minutes > 0) {
			return `${minutes}m`;
		} else {
			return `${remainingSeconds}s`;
		}
	}
	

    async getPomodoroLog(): Promise<string> {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const content = await this.app.vault.read(activeFile); // Await the read operation
            const pomodoroLogMatch = content.match(/pomosidian_log: \|\-[\s\S]*?(?=\n---)/m);
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