import webpack from "webpack";

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
  plugins: [new webpack.EnvironmentPlugin(["EXTENSION_ID"])],
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  },
};

export default config;
