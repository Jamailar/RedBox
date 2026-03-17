import * as fs from 'fs';
import * as path from 'path';

/**
 * PromptLoader - 负责从磁盘加载 .txt 格式的提示词
 */
export class PromptLoader {
    private libraryPath: string;

    constructor() {
        // 智能路径探测
        const devPath = path.join(process.cwd(), 'desktop/electron/prompts/library');
        const prodPath = path.join(__dirname, 'library');

        if (fs.existsSync(devPath)) {
            this.libraryPath = devPath;
        } else {
            this.libraryPath = prodPath;
        }

        console.log(`[PromptLoader] Initialized with library path: ${this.libraryPath}`);
    }

    /**
     * 加载单个提示词文件
     * @param relativePath 相对 library 目录的路径，例如 'intent.txt' 或 'personas/default.txt'
     */
    public load(relativePath: string): string {
        const fullPath = path.join(this.libraryPath, relativePath);
        try {
            if (fs.existsSync(fullPath)) {
                return fs.readFileSync(fullPath, 'utf-8').trim();
            }
            console.warn(`[PromptLoader] Prompt file not found: ${fullPath}`);
            return '';
        } catch (error) {
            console.error(`[PromptLoader] Failed to load prompt: ${fullPath}`, error);
            return '';
        }
    }

    /**
     * 批量加载目录下的所有 .txt 文件到一个对象中
     * @param subDir 子目录名称，例如 'personas'
     */
    public loadDir(subDir: string): Record<string, string> {
        const dirPath = path.join(this.libraryPath, subDir);
        const result: Record<string, string> = {};

        try {
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    if (file.endsWith('.txt')) {
                        const name = path.basename(file, '.txt');
                        result[name] = fs.readFileSync(path.join(dirPath, file), 'utf-8').trim();
                    }
                }
            }
        } catch (error) {
            console.error(`[PromptLoader] Failed to load directory: ${dirPath}`, error);
        }

        return result;
    }
}

// 导出单例
export const promptLoader = new PromptLoader();
