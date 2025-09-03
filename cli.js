#!/usr/bin/env node
import prompts from "prompts";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cwd = process.cwd();

function detectPkgManager() {
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

const PACKAGE_MANAGER = detectPkgManager();

function install(pkgs, dev = true) {
  let cmd = "";
  const pkgsList = Array.isArray(pkgs) ? pkgs.join(" ") : pkgs;

  if (PACKAGE_MANAGER === "yarn") {
    cmd = `yarn add ${dev ? "-D " : ""}${pkgsList}`;
  } else if (PACKAGE_MANAGER === "pnpm") {
    cmd = `pnpm add ${dev ? "-D " : ""}${pkgsList}`;
  } else {
    cmd = `npm install ${dev ? "--save-dev " : ""}${pkgsList}`;
  }

  console.log(`➡️ Installing: ${pkgsList} with ${PACKAGE_MANAGER}...`);
  execSync(cmd, { stdio: "inherit" });
}

function copyFileFromTemplate(srcFile, destDir = ".") {
  const srcPath = path.join(__dirname, "template-files", srcFile);
  const targetPath = path.join(process.cwd(), destDir, path.basename(srcFile));

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(srcPath, targetPath);
}

const run = async () => {
  console.log("🚀 Welcome to ally-my-app setup!");

  const { axe } = await prompts({
    type: "toggle",
    name: "axe",
    message: "Would you like to add Axe accessibility testing?",
    initial: true,
    active: "yes",
    inactive: "no",
  });

  const { pa11y } = await prompts({
    type: "toggle",
    name: "pa11y",
    message: "Would you like to add Pa11y accessibility testing?",
    initial: true,
    active: "yes",
    inactive: "no",
  });

  const { lighthouse } = await prompts({
    type: "toggle",
    name: "lighthouse",
    message: "Would you like to add Lighthouse accessibility testing?",
    initial: true,
    active: "yes",
    inactive: "no",
  });

  const tools = [];
  if (axe) tools.push("axe");
  if (pa11y) tools.push("pa11y");
  if (lighthouse) tools.push("lighthouse");

  // 2. CI integration - to be added later
  const { ci } =
    tools.length < 1
      ? { ci: false }
      : await prompts({
          type: "toggle",
          name: "ci",
          message: "Would you like to integrate them into your CI workflow?",
          initial: true,
          active: "yes",
          inactive: "no",
        });

  // 3. Accessibility linting
  const { lint } = await prompts({
    type: "toggle",
    name: "lint",
    message: "Enable accessibility linting (jsx-a11y)?",
    initial: true,
    active: "yes",
    inactive: "no",
  });

  console.log("\n✅ Config chosen:");
  console.log({ tools, ci, lint });

  const NAMES_TO_DEPS = {
    pa11y: "pa11y",
    axe: "@axe-core/cli",
    lighthouse: "@lhci/cli",
  };

  // execution

  if (tools.length > 0) {
    console.log("📦 Installing accessibility testing tools...");
    install(tools.map((tool) => NAMES_TO_DEPS[tool]));

    if (tools.includes("lighthouse")) {
      console.log("⚙️ Adding Lighthouse config...");
      copyFileFromTemplate("lighthouserc.json");
    }
  }

  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  if (!pkg.scripts) pkg.scripts = {};

  if (tools.length > 0) {
    console.log("⚙️ Adding scripts to package.json...");
    pkg.scripts["preview"] = "vite preview";
  }

  if (tools.includes("axe")) {
    pkg.scripts["a11y:axe"] = "axe http://localhost:3000 --exit";
  }
  if (tools.includes("pa11y")) {
    pkg.scripts["a11y:pa11y"] =
      "pa11y --standard WCAG2AA --timeout 30000 --wait 2000 --include-warnings http://localhost:3000";
  }
  if (tools.includes("lighthouse")) {
    pkg.scripts["a11y:lighthouse"] = "lhci autorun";
  }

  const pmCmd = PACKAGE_MANAGER === "npm" ? "npm run" : PACKAGE_MANAGER;
  const cmds = [];

  if (tools.length > 0) {
    if (tools.includes("axe")) cmds.push(`${pmCmd} a11y:axe`);
    if (tools.includes("pa11y")) cmds.push(`${pmCmd} a11y:pa11y`);
    if (tools.includes("lighthouse")) cmds.push(`${pmCmd} a11y:lighthouse`);

    if (cmds.length > 0) {
      pkg.scripts["a11y:all"] = `concurrently "${cmds.join('" "')}"`;
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    if (cmds.length > 0) {
      install(["concurrently"]);
    }

    console.log("✅ Added accessibility scripts to package.json");
  }

  if (ci) {
    const WORKFLOWS_DIR = "./.github/workflows";
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

    const toolsArray = `[${tools.map((tool) => (tool === "axe" ? "axe-core" : tool)).join(", ")}]`;

    const workflowContent = `name: Accessibility Testing

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  TEST_BASE_URL: http://localhost:3000
  TEST_PAGES: "/"

jobs:
  setup:
    name: Setup and build
    runs-on: ubuntu-latest
    outputs:
      cache-key: \${{ steps.cache-key.outputs.key }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "yarn"

      - name: Generate cache key
        id: cache-key
        run: echo "key=\${{ runner.os }}-a11y-node20-\${{ hashFiles('yarn.lock') }}" >> $GITHUB_OUTPUT

      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: node_modules
          key: \${{ steps.cache-key.outputs.key }}
          restore-keys: |
            \${{ runner.os }}-a11y-node20-

      - name: Verify Node.js version
        run: node --version

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Build site
        run: yarn build

      - name: Cache build output
        uses: actions/cache@v4
        with:
          path: dist
          key: \${{ runner.os }}-build-\${{ github.sha }}

  ${
    tools.includes("axe")
      ? `axe-core:
    name: Axe Core Accessibility Testing
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "yarn"

      - name: Restore dependencies
        uses: actions/cache@v4
        with:
          path: node_modules
          key: \${{ needs.setup.outputs.cache-key }}

      - name: Restore build output
        uses: actions/cache@v4
        with:
          path: dist
          key: \${{ runner.os }}-build-\${{ github.sha }}

      - name: Start preview server
        run: |
          yarn preview --port 3000 &
          npx wait-on http://localhost:3000 --timeout 60000

      - name: Install Axe CLI
        run: npm install -g @axe-core/cli

      - name: Run Axe accessibility tests
        run: |
          # Use routes
          IFS=' ' read -ra PAGE_PATHS <<< "$TEST_PAGES"

          mkdir -p axe-results
          FAILED=0

          for path in "\${PAGE_PATHS[@]}"; do
            url="\${TEST_BASE_URL}\${path}"
            echo "Testing $url with Axe Core..."
            PAGE_NAME=$(echo $path | sed 's|/|-|g' | sed 's|^-||')
            if [ -z "$PAGE_NAME" ]; then PAGE_NAME="home"; fi
            
            if ! axe "$url" \
              --save "axe-results/axe-$PAGE_NAME.json" \
              --tags wcag2a,wcag2aa,wcag21aa; then
              FAILED=1
            fi
          done

          # Combine all results into one file
          echo '{"results":[' > axe-results.json
          first=true
          for file in axe-results/axe-*.json; do
            # Check if the file actually exists (handles case where no files match the pattern)
            if [ -f "$file" ]; then
              if [ "$first" = true ]; then
                first=false
              else
                echo ',' >> axe-results.json
              fi
              cat "$file" >> axe-results.json
            fi
          done
          echo ']}' >> axe-results.json

          if [ $FAILED -eq 1 ]; then
            exit 1
          fi

      - name: Upload Axe results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: axe-accessibility-results
          path: |
            axe-results.json
            axe-results/
            `
      : ""
  }  
  ${
    tools.includes("lighthouse")
      ? `lighthouse:
    name: Lighthouse Accessibility & Performance
    runs-on: ubuntu-latest
    needs: setup
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.A11Y_GITHUB_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "yarn"
  
      - name: Restore dependencies
        uses: actions/cache@v4
        with:
          path: node_modules
          key: \${{ needs.setup.outputs.cache-key }}
  
      - name: Restore build output
        uses: actions/cache@v4
        with:
          path: dist
          key: \${{ runner.os }}-build-\${{ github.sha }}
  
      - name: Install Lighthouse CI
        run: npm install -g @lhci/cli@0.13.x
  
      - name: Debug Lighthouse CI setup
        run: |
          echo "Lighthouse CI version:"
          lhci --version
          echo "Current directory:"
          pwd
          echo "Lighthouse config:"
          cat lighthouserc.json
  
      - name: Start preview server
        run: |
          yarn preview --port 3000 &
          npx wait-on http://localhost:3000 --timeout 60000
  
      - name: Verify server is responding
        run: |
          echo "Testing server response..."
          curl -f $TEST_BASE_URL/ || (echo "Server not responding" && exit 1)
          echo "Server is responding correctly!"
  
      - name: Run Lighthouse CI
        env:
          LHCI_GITHUB_TOKEN: \${{ secrets.A11Y_GITHUB_TOKEN }}
          LHCI_UPLOAD_TARGET: github
        run: |
          lhci autorun --debug
          echo "Lighthouse CI completed (exit code: $?)"
  
      - name: Collect Lighthouse artifacts
        if: always()
        run: |
          # Create lighthouse-results directory for artifacts
          mkdir -p lighthouse-results
  
          # Copy any generated reports
          if [ -d ".lighthouseci" ]; then
            cp -r .lighthouseci/* lighthouse-results/ 2>/dev/null || true
          fi
  
          # Copy any lhci reports
          if [ -d "lhci_reports" ]; then
            cp -r lhci_reports/* lighthouse-results/ 2>/dev/null || true
          fi
  
          # Create a summary file with the URLs that were tested
          echo "Lighthouse CI Results Summary" > lighthouse-results/summary.txt
          echo "=============================" >> lighthouse-results/summary.txt
          echo "Tested URLs:" >> lighthouse-results/summary.txt
          cat lighthouserc.json | grep -A 10 '"url"' >> lighthouse-results/summary.txt
          echo "" >> lighthouse-results/summary.txt
          echo "Generated at: $(date)" >> lighthouse-results/summary.txt
          echo "Commit: \${{ github.sha }}" >> lighthouse-results/summary.txt
  
          # List what we collected
          echo "Lighthouse artifacts collected:"
          ls -la lighthouse-results/ || echo "No lighthouse artifacts found"
  
      - name: Upload Lighthouse results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lighthouse-results
          path: lighthouse-results/
          `
      : ""
  }
  ${
    tools.includes("pa11y")
      ? `pa11y:
    name: Pa11y Accessibility Testing
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "yarn"

      - name: Restore dependencies
        uses: actions/cache@v4
        with:
          path: node_modules
          key: \${{ needs.setup.outputs.cache-key }}

      - name: Restore build output
        uses: actions/cache@v4
        with:
          path: dist
          key: \${{ runner.os }}-build-\${{ github.sha }}

      - name: Start preview server
        run: |
          yarn preview --port 3000 &
          npx wait-on http://localhost:3000 --timeout 60000

      - name: Install Pa11y
        run: npm install -g pa11y

      - name: Run Pa11y accessibility tests
        env:
          PUPPETEER_EXECUTABLE_PATH: /usr/bin/google-chrome-stable
        run: |
          # Test all pages with Puppeteer launch args via environment
          export PUPPETEER_LAUNCH_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --headless"

          # Use extracted routes
          IFS=' ' read -ra PAGE_PATHS <<< "$TEST_PAGES"

          mkdir -p pa11y-results
          FAILED=0

          echo '{"results":[' > pa11y-results.json
          first=true

          for path in "\${PAGE_PATHS[@]}"; do
            url="\${TEST_BASE_URL}${path}"
            echo "Testing $url with Pa11y..."
            PAGE_NAME=$(echo $path | sed 's|/|-|g' | sed 's|^-||')
            if [ -z "$PAGE_NAME" ]; then PAGE_NAME="home"; fi
            
            # Run with JSON reporter
            if pa11y "$url" \
              --reporter json \
              > "pa11y-results/pa11y-$PAGE_NAME.json"; then
              if [ "$first" = true ]; then
                first=false
              else
                echo ',' >> pa11y-results.json
              fi
              cat "pa11y-results/pa11y-$PAGE_NAME.json" >> pa11y-results.json
            else
              FAILED=1
              echo "Pa11y failed for $url"
            fi
            
            # Also run with CLI reporter for human-readable output
            echo "=== Pa11y results for $url ==="
            pa11y "$url" \
              --reporter cli \
              || true
            echo ""
          done

      - name: Upload Pa11y results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: pa11y-accessibility-results
          path: |
            pa11y-results.json
            pa11y-results/
            `
      : ""
  }
  accessibility-comment:
    name: Accessibility Test Summary Comment
    runs-on: ubuntu-latest
    needs: ${toolsArray}
    if: always() && github.event_name == 'pull_request'
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4

      - name: Create accessibility summary comment
        uses: actions/github-script@v7
        with:
          github-token: \${{ secrets.A11Y_GITHUB_TOKEN }}
          script: |
            const fs = require('fs');

            // First, find and delete any existing accessibility comments
            const comments = await github.rest.issues.listComments({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
            });

            // Find comments made by this workflow (containing our identifier)
            const accessibilityComments = comments.data.filter(comment => 
              comment.body.includes('🔍 Accessibility Test Results') &&
              comment.body.includes('🤖 This comment was automatically generated by the accessibility testing workflow')
            );

            // Delete existing accessibility comments
            for (const comment of accessibilityComments) {
              console.log(\`Deleting previous accessibility comment: \${comment.id}\`);
              try {
                await github.rest.issues.deleteComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  comment_id: comment.id,
                });
              } catch (error) {
                console.log(\`Could not delete comment \${comment.id}: \${error.message}\`);
              }
            }

            // Get job results
            ${
              tools.includes("axe")
                ? `const axeResult = '\${{ needs.axe-core.result }}';`
                : ""
            }
            ${
              tools.includes("lighthouse")
                ? `const lighthouseResult = '\${{ needs.lighthouse.result }}';`
                : ""
            }
            ${
              tools.includes("pa11y")
                ? `const pa11yResult = '\${{ needs.pa11y.result }}';`
                : ""
            }

            // Helper function to get status emoji and text
            function getStatusDisplay(result) {
              switch(result) {
                case 'success': return { emoji: '✅', text: 'Passed' };
                case 'failure': return { emoji: '❌', text: 'Failed' };
                case 'cancelled': return { emoji: '⏭️', text: 'Cancelled' };
                case 'skipped': return { emoji: '⚪', text: 'Skipped' };
                default: return { emoji: '❓', text: 'Unknown' };
              }
            }

            ${
              tools.includes("axe")
                ? `const axeStatus = getStatusDisplay(axeResult);`
                : ""
            }
            ${
              tools.includes("lighthouse")
                ? `const lighthouseStatus = getStatusDisplay(lighthouseResult);`
                : ""
            }
            ${
              tools.includes("pa11y")
                ? `const pa11yStatus = getStatusDisplay(pa11yResult);`
                : ""
            }

            ${
              tools.includes("lighthouse")
                ? `// Read routes that were tested
            let testedRoutes = 'Unknown';
            try {
              if (fs.existsSync('lighthouse-results/summary.txt')) {
                const summary = fs.readFileSync('lighthouse-results/summary.txt', 'utf8');
                const urlMatch = summary.match(/Tested URLs:(.*?)Generated at:/s);
                if (urlMatch) {
                  testedRoutes = urlMatch[1].trim().replace(/"/g, '').replace(/\[|\]/g, '').split(',').map(url => url.trim()).join(', ');
                }
              }
            } catch (error) {
              console.log('Could not read lighthouse summary:', error.message);
            }`
                : ""
            }
            // Count issues if available
            let issueDetails = '';
            try {
            ${
              tools.includes("axe")
                ? `// Try to read Axe results
              if (fs.existsSync('axe-accessibility-results/axe-results.json')) {
                const axeData = JSON.parse(fs.readFileSync('axe-accessibility-results/axe-results.json', 'utf8'));
                if (axeData.violations && axeData.violations.length > 0) {
                  issueDetails += \`\\n**Axe Issues Found:** \${axeData.violations.length} violation(s)\`;
                }
              }`
                : ""
            }
            ${
              tools.includes("pa11y")
                ? `// Try to read Pa11y results  
              if (fs.existsSync('pa11y-accessibility-results/pa11y-results.json')) {
                const pa11yData = JSON.parse(fs.readFileSync('pa11y-accessibility-results/pa11y-results.json', 'utf8'));
                if (pa11yData.results && pa11yData.results.length > 0) {
                  const totalIssues = pa11yData.results.reduce((sum, result) => sum + (result.issues ? result.issues.length : 0), 0);
                  if (totalIssues > 0) {
                    issueDetails += \`\\n**Pa11y Issues Found:** \${totalIssues} issue(s)\`;
                  }
                }
              }`
                : ""
            }  
            } catch (error) {
              console.log('Could not parse accessibility results:', error.message);
            }

            const comment = \`## 🔍 Accessibility Test Results

            | Tool | Status | Result |
            |------|--------|--------|
            ${
              tools.includes("axe")
                ? `| **Axe Core** | \${axeStatus.emoji} | \${axeStatus.text} |`
                : ""
            }
            ${
              tools.includes("lighthouse")
                ? `| **Lighthouse** | \${lighthouseStatus.emoji} | \${lighthouseStatus.text} |`
                : ""
            }
            ${
              tools.includes("pa11y")
                ? `| **Pa11y** | \${pa11yStatus.emoji} | \${pa11yStatus.text} |`
                : ""
            }

            Download detailed results from the **Artifacts** section of this workflow run

            ---
            <sub>🤖 This comment was automatically generated by the accessibility testing workflow</sub>\`;

            // Post the comment
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });

  accessibility-summary:
    name: Accessibility Test Summary
    runs-on: ubuntu-latest
    needs: ${toolsArray}
    if: always()
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4

      - name: Create accessibility summary
        run: |
          echo "# 🔍 Accessibility Test Results" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY

          ${
            tools.includes("axe")
              ? `# Check Axe results
          if [ "\${{ needs.axe-core.result }}" = "success" ]; then
            echo "✅ **Axe Core**: All accessibility tests passed" >> $GITHUB_STEP_SUMMARY
          else
            echo "❌ **Axe Core**: Accessibility issues found" >> $GITHUB_STEP_SUMMARY
          fi`
              : ""
          }
          ${
            tools.includes("lighthouse")
              ? `# Check Lighthouse results
          if [ "\${{ needs.lighthouse.result }}" = "success" ]; then
            echo "✅ **Lighthouse**: Performance and accessibility scores met thresholds" >> $GITHUB_STEP_SUMMARY
          else
            echo "⚠️ **Lighthouse**: Performance or accessibility scores below threshold" >> $GITHUB_STEP_SUMMARY
          fi`
              : ""
          }
          ${
            tools.includes("pa11y")
              ? `# Check Pa11y results
          if [ "\${{ needs.pa11y.result }}" = "success" ]; then
            echo "✅ **Pa11y**: No accessibility violations detected" >> $GITHUB_STEP_SUMMARY
          else
            echo "❌ **Pa11y**: Accessibility violations found" >> $GITHUB_STEP_SUMMARY
          fi`
              : ""
          }
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "📊 **Test artifacts are available for download in the workflow run**" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY`;

    fs.writeFileSync(
      path.join(WORKFLOWS_DIR, "accessibility.yml"),
      workflowContent
    );

    console.log("✅ accessibility.yml generated");
  }

  if (lint) {
    console.log("📦 Adding eslint-plugin-jsx-a11y...");
    install(["eslint-plugin-jsx-a11y"]);

    const eslintPath = path.join(process.cwd(), "eslint.config.js");
    if (fs.existsSync(eslintPath)) {
      let content = fs.readFileSync(eslintPath, "utf-8");

      if (!content.includes('import jsxA11y from "eslint-plugin-jsx-a11y"')) {
        content = content.replace(
          /(import.*?from.*?['"].*['"];?\s*)/s,
          `import jsxA11y from "eslint-plugin-jsx-a11y";\n$1`
        );
      }

      if (!/plugins\s*:\s*{/.test(content)) {
        content = content.replace(
          /export\s+default\s+{/,
          `export default {\n  plugins: {\n    "jsx-a11y": jsxA11y,\n  },`
        );
      } else if (!content.includes("jsx-a11y: jsxA11y")) {
        content = content.replace(
          /(plugins\s*:\s*{)/s,
          `$1\n    "jsx-a11y": jsxA11y,`
        );
      }

      fs.writeFileSync(eslintPath, content);
      console.log("✅ Updated eslint.config.js with jsx-a11y plugin");
    }
  }

  console.log("\n✨ Done! Your project is now boosted with accessibility!");
};

run();
