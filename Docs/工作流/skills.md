Gemini CLI 技能 (Skills) 系统实现机制详解
本文档详细解析了 Gemini CLI 中 "Skills" (技能) 的代码实现逻辑。该系统设计采用了渐进式披露 (Progressive Disclosure) 策略，以最大化利用 Context Window（上下文窗口）并保持 Agent 的专注度。

一、核心设计理念：渐进式披露 (Progressive Disclosure)
这是整个实现中最关键的部分。为了避免一次性把所有技能的详细指令灌入 LLM 上下文，导致 Context 爆炸或注意力分散，系统采用了“菜单 vs 菜谱”的模式：

默认状态 (Menu)：LLM 只看得到所有技能的名称和简短描述。
按需加载 (Recipe)：LLM 只有在决定使用某个技能并调用工具激活它后，系统才会把该技能的完整指令 (Body) 和资源列表注入到当前对话中。
二、代码实现流程
1. 技能定义 (Definition)
文件位置: 
packages/core/src/skills/skillLoader.ts
 技能并非复杂的 Class，而是一个标准化的文件夹结构：

my-skill/
├── SKILL.md          <-- 核心定义文件
├── scripts/          <-- 可执行脚本
└── references/       <-- 参考文档
SKILL.md
 分为两部分：

Frontmatter (元数据)：YAML 格式，包含 name 和 description。这部分会始终存在于 System Prompt 中。
Body (正文)：Markdown 格式的详细指令。这部分只有激活后才会被 LLM 看到。
2. 发现与加载 (Discovery & Loading)
文件位置: 
packages/core/src/skills/skillManager.ts

SkillManager
 会在启动时扫描以下位置（优先级由低到高）：

Built-in: 内置技能 (packages/core/src/skills/builtin)
Extensions: 插件提供的技能
User Global: 用户全局目录 (~/.gemini/skills)
Workspace: 当前项目目录 (.gemini/skills)
加载器只解析 
SKILL.md
 的元数据，将其存入内存。

3. 注入系统提示词 (Prompt Injection)
文件位置: 
packages/core/src/core/prompts.ts

在构建 System Prompt 时，代码会调用 SkillManager.getSkills() 获取所有可用技能，并生成如下 XML 结构注入提示词：

# Available Agent Skills
You have access to the following specialized skills. To activate a skill... call the `activate_skill` tool...
<available_skills>
  <skill>
    <name>deploy-helper</name>
    <description>Helps with deploying applications to Kubernetes.</description>
    <location>...</location>
  </skill>
  ...
</available_skills>
关键点：这里只注入了 description，没有注入 Body。LLM 必须通过描述判断是否需要该技能。

4. 激活技能 (Activation via Tool)
文件位置: 
packages/core/src/tools/activate-skill.ts

当 LLM 决定使用技能时，它会调用 activate_skill 工具：

{
  "name": "activate_skill",
  "arguments": { "name": "deploy-helper" }
}
工具执行逻辑 (
ActivateSkillTool
)：

验证: 检查技能是否存在。
授权: 将技能目录加入 Workspace Context（允许 Agent 读取技能内的脚本和文件）。
返回指令: 将技能的 完整 Body 和 资源列表 作为工具的输出 (Observation) 返回给 LLM。
返回内容示例：

<activated_skill name="deploy-helper">
  <instructions>
     Here are the steps to deploy...
     1. Run existing build script...
     2. Check kubernetes context...
  </instructions>
  <available_resources>
     scripts/check_k8s.sh
     references/deploy_guide.md
  </available_resources>
</activated_skill>
5. 执行与使用
一旦技能被激活，LLM 在后续的对话中就拥有了该技能的完整上下文（直到超出 Context 限制或被压缩）。它现在可以遵循 <instructions> 中的步骤，并调用 run_shell_command 执行 <available_resources> 中的脚本。

三、业务流程总结
SkillManager
ActivateSkillTool
LLM
System Prompt
User
SkillManager
ActivateSkillTool
LLM
System Prompt
User
1. 启动时扫描 SKILL.md
getSkills()
返回 [Name, Description] 列表
注入 <available_skills> (仅描述)
"帮我部署到 K8s"
思考：System Prompt 里有个 deploy-helper 技能\n描述很符合，我应该激活它。
Call activate_skill("deploy-helper")
getSkill("deploy-helper")
返回完整内容 (包含 Body & Path)
Return <activated_skill>...\n包含详细步骤和脚本路径
思考：收到了详细步骤，现在开始执行...
"正在启动部署流程，首先执行检查脚本..."
四、如何创建一个新技能
根据源码中的 skill-creator 技能说明，标准流程如下：

运行 node scripts/init_skill.cjs my-new-skill 初始化目录。
编写 
SKILL.md
，确保 frontmatter 的 description 足够准确（这是 LLM 检索它的唯一索引）。
将复杂的重复性任务写成脚本放入 scripts/ 目录。
运行 node scripts/package_skill.cjs 打包。
使用 gemini skills install 安装。