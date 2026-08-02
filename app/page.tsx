import type { Metadata } from "next";
import { TrainVisualizer } from "./components/TrainVisualizer";

export const metadata: Metadata = {
  title: "Rail Flow · 列车运行可视化",
  description: "编辑铁路网络、定义列车 Service，并实时模拟列车运行。",
};

export default function Home() {
  return <TrainVisualizer />;
}
