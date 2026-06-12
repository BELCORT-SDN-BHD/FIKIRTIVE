import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
// the brand scenes use backdrop-filter / gradients — keep full quality
Config.setChromiumOpenGlRenderer("angle");
