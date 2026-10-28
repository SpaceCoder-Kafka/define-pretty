# Define Pretty

[简体中文](README.md) · English

**Turn the design details you love into selectable options.**

Upload a UI screenshot you like and let Codex extract its colors, typography, layout, and more. Select the elements you want to borrow, then give Codex the resulting visual specifications and instructions to reproduce the reference's visual characteristics with high fidelity.

[Showcase](#showcase) · [Quick Start](#quick-start) · [How to Use](#how-to-use) · [FAQ](#faq)

## Showcase

<table>
  <thead>
    <tr>
      <th width="33%">Original Page</th>
      <th width="33%">UI Specifications</th>
      <th width="33%">Redesigned Page</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td valign="top"><strong>Personal Blog · City Illustrations</strong><br><br><a href="docs/images/showcase/blog/original.jpg"><img src="docs/images/showcase/blog/original.jpg" width="300" alt="Original personal blog with blue-purple gradients and article cards"></a></td>
      <td valign="top"><a href="docs/images/showcase/blog/01-feature.png"><img src="docs/images/showcase/blog/01-feature.png" width="300" alt="UI specifications for city illustrations: colors, typography, layout, and illustration details"></a></td>
      <td valign="top"><a href="docs/images/showcase/blog/01-preview.png"><img src="docs/images/showcase/blog/01-preview.png" width="300" alt="Redesigned personal blog with teal color blocks and city illustrations"></a></td>
    </tr>
    <tr>
      <td valign="top"><strong>Personal Blog · Magazine Collage</strong><br><br><a href="docs/images/showcase/blog/original.jpg"><img src="docs/images/showcase/blog/original.jpg" width="300" alt="The same original personal blog"></a></td>
      <td valign="top"><a href="docs/images/showcase/blog/02-feature.png"><img src="docs/images/showcase/blog/02-feature.png" width="300" alt="UI specifications for magazine collage: oversized headlines, portrait photography, and hand-drawn marks"></a></td>
      <td valign="top"><a href="docs/images/showcase/blog/02-preview.jpg"><img src="docs/images/showcase/blog/02-preview.jpg" width="300" alt="Redesigned personal blog with portraits, pink and blue colors, and magazine collage"></a></td>
    </tr>
    <tr>
      <td valign="top"><strong>Data Dashboard · Green and Gray</strong><br><br><a href="docs/images/showcase/dashboard/original.jpg"><img src="docs/images/showcase/dashboard/original.jpg" width="300" alt="Original data dashboard with a dark neon theme"></a></td>
      <td valign="top"><a href="docs/images/showcase/dashboard/01-feature.png"><img src="docs/images/showcase/dashboard/01-feature.png" width="300" alt="Dashboard UI specifications: green-gray colors, rounded containers, and ticket-style lists"></a></td>
      <td valign="top"><a href="docs/images/showcase/dashboard/01-preview.jpg"><img src="docs/images/showcase/dashboard/01-preview.jpg" width="300" alt="Redesigned data dashboard with a green-gray background, white content areas, and gold accents"></a></td>
    </tr>
    <tr>
      <td valign="top"><strong>Personal Résumé · Retro Collage</strong><br><br><a href="docs/images/showcase/resume/original.jpg"><img src="docs/images/showcase/resume/original.jpg" width="300" alt="Original personal résumé with a gradient background and experience and skills cards"></a></td>
      <td valign="top"><a href="docs/images/showcase/resume/01-feature.png"><img src="docs/images/showcase/resume/01-feature.png" width="300" alt="UI specifications for retro collage: colorful sections, bold headlines, and print textures"></a></td>
      <td valign="top"><a href="docs/images/showcase/resume/01-preview.jpg"><img src="docs/images/showcase/resume/01-preview.jpg" width="300" alt="Redesigned personal résumé with yellow, orange, and green sections and retro photo collage"></a></td>
    </tr>
  </tbody>
</table>

Borrow just the colors and typography, or also select layouts, textures, and decorative elements, then specify where each should apply. Results vary with the reference image, selected features, and model.

<details>
<summary>View the workbench and an example export</summary>

**Home page**

[![Define Pretty home page: upload a reference and start choosing design features](docs/images/app-home.jpg)](docs/images/app-home.jpg)

**Choose design features**

The reference sits in the center, surrounded by selectable design features. Color palettes, layout proportions, and close-up examples make each feature easy to inspect.

[![Design overview with the reference image, foundational specifications, and selectable visual features](docs/images/feature-overview.jpg)](docs/images/feature-overview.jpg)

**Exported visual overview**

The overview contains only your selected features. Give it to your AI assistant together with the unmarked original image and accompanying instructions.

[![Exported PNG overview of selected design features](docs/images/selected-features.png)](docs/images/selected-features.png)

</details>

## Quick Start

### 1. Launch the workbench

Install **[Node.js](https://nodejs.org/) 22.12 or later**, which includes npm and npx.

Download `define-pretty.tgz` from this repository's **[Releases](https://github.com/SpaceCoder-Kafka/define-pretty/releases)**, open a terminal in the download directory, and run:

```sh
npx --yes --package ./define-pretty.tgz define-pretty
```

The workbench opens automatically in your browser. Keep the terminal running; press **Ctrl+C** when you are done. If the browser does not open, visit the address printed in the terminal.

<details>
<summary>No release package yet? You can also run from source</summary>

Download or clone this repository, then run these commands in the project directory:

```sh
npm ci
npm run dev
```

Open the workbench address printed in the terminal. The default is `http://127.0.0.1:4193/`.

</details>

### 2. Try the guided tour

On your first visit, a guided tour walks you through the reference image, feature selection, page comparison, and export. **No image upload, Codex installation, or Codex login is required** to try these bundled examples.

Skip it whenever you like, or click **Usage Guide (使用指引)** in the header to replay it.

### 3. Use your own reference images

Extracting features, using AI completion, and generating pages require **[Codex CLI](https://developers.openai.com/codex/cli/)** to be installed and signed in on your computer. After installation, run:

```sh
codex login
```

Then restart Define Pretty. It uses your existing local Codex login and configuration.

Page screenshots and validation use Chrome, Edge, or Chromium installed on your computer. If no compatible browser is found, run:

```sh
npx --yes --package ./define-pretty.tgz define-pretty --install-browser
```

## How to Use

Button names below include their Chinese UI labels to help you find them in the app.

### 1. Add a reference image you like

Click **Upload Reference Image (上传参考图)**, or drag an image into the upload area. Supported formats are **PNG, JPG, and WebP**, up to **10 MB**.

Choose a clear screenshot that shows the page structure and text hierarchy. A full-page screenshot is a good starting point.

### 2. Extract the design and select what you like

Click **Extract Foundations and Distinctive Features (提炼基础与辨识特征)** and wait for the design cards to appear.

| Card type | What it shows |
| --- | --- |
| Foundations | Overall visual style, typography and text hierarchy, layout and spacing, and the distribution of colors and light and dark areas |
| Distinctive features | Details that make the reference recognizable, such as torn-paper edges, hard borders, offset shadows, or an illustration style |
| Fine details | Additional details found with **Discover More Details (发现更多细节)**, ready to select as needed |

Complete cards from the first extraction are selected by default; deselect anything you do not want. Newly discovered details are unselected by default. Hover over a card to locate it in the reference, or click **View Original (查看原图)** for a closer look.

### 3. Try the design on a page

Next to **Original Page (原始网页)** in the lower section, click **Change Page (更换网页)**, choose a scenario, and click **Use This Page (使用此页)**. There are **8 built-in pages** ready to use: a data dashboard, personal résumé, personal blog, SaaS website, designer portfolio, e-commerce product page, online courses, and event registration.

You can also expand **Custom Original Page (自定义原始网页)** and describe what you need to have AI generate a starting page.

Click **Validate Selected Design (验证所选设计)**. Once it finishes, compare the original and redesigned pages side by side, or open either in full screen. To refine the result, enter specific feedback and click **Continue Refining This Result (继续优化此结果)**. For example:

> Keep the current paper texture, but make the main headline smaller so the first row of articles is visible without scrolling.

Each refinement is saved as a separate record. It uses the reference image and selected features from that run. If you change your card selections, click **Validate Selected Design (验证所选设计)** again.

### 4. Bring it into your own project

You can also click **Preview and Export Images (预览并导出图片)** at the bottom to take these three items with you:

1. **Overview PNG**: your selected design features and key parameters.
2. **Unmarked original image**: the full reference so AI can inspect the visual details.
3. **Accompanying instructions**: the complete requirements for your selections, including where you want them applied.

Give your AI assistant **both images and the accompanying instructions**, then add your project goal. For example:

> Follow the accompanying instructions to apply my selected design features to this blog project. Keep the existing articles, navigation, and search, and create suitable visual assets around the blog's subject matter.

## FAQ

**Can I upload an existing website?**

The workbench currently supports built-in pages, custom AI-generated pages, and pages from your history. Uploading website projects is not yet supported. To use the design in your own codebase, export the images and instructions and give them to your AI assistant in that project.

**Where do I choose a model?**

**Generation Settings (生成设置)** in the header controls feature extraction and AI completion. **Test Model (测试模型)** in the page validation area controls page generation, validation, and further refinements. Available models are provided by your local Codex CLI.

**Will my work still be there after I close the app?**

Reference images, cards, and task history are saved locally and remain available after restarting. The guided tour is a temporary demo and does not save changes to your workspace. Real AI tasks require internet access and use the account and quota of your configured service.

**What if startup or generation fails?**

Check your Node.js version and make sure Codex CLI is installed and signed in. You can also run the environment check:

```sh
npx --yes --package ./define-pretty.tgz define-pretty --doctor
```

Restart the workbench after installing or updating Codex, or changing your login. Release checks currently cover macOS and Linux; equivalent validation has not yet been completed for Windows.

---

Share feedback and examples through [Issues](https://github.com/SpaceCoder-Kafka/define-pretty/issues). For running from source, configuration, and packaging, see the [Development and Release Guide](docs/development.md) (Chinese).
