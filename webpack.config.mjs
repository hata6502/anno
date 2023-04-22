import Dotenv from "dotenv-webpack";

const config = {
  mode: "production",
  entry: {
    annotation: "./src/annotation.ts",
    background: "./src/background.ts",
    content: "./src/content.ts",
    options: "./src/options.ts",
    scrapboxContent: "./src/scrapboxContent.ts",
    scrapboxUserScript: "./src/scrapboxUserScript.ts",
  },
  experiments: {
    topLevelAwait: true,
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: "ts-loader",
        options: {
          transpileOnly: true,
        },
      },
    ],
  },
  plugins: [new Dotenv()],
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
};

export default config;
