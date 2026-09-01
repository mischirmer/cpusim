export interface ProcessorConfig {
  wordBits: 16;
  registerCount: 16;
  pipelineStages: readonly ["IF", "ID", "OF", "EX", "WB"];
  forwarding: { enabled: boolean };
  timing: {
    registerReadStage: "OF";
    registerWriteStage: "WB";
    flagReadStage: "OF";
    flagWriteStage: "EX";
    branchResolveStage: "EX";
    sameCycleWbToOfVisible: false;
  };
  branches: {
    speculativeSequentialFetch: true;
    prediction: "none";
  };
  memory: { addressBits: 16; endianness: "big" };
  subtractionCarryConvention: "borrow-means-C1";
  branchBase: "instruction-address";
  maxCycles: number;
}

export const DEFAULT_CONFIG: ProcessorConfig = {
  wordBits: 16,
  registerCount: 16,
  pipelineStages: ["IF", "ID", "OF", "EX", "WB"],
  forwarding: { enabled: false },
  timing: {
    registerReadStage: "OF",
    registerWriteStage: "WB",
    flagReadStage: "OF",
    flagWriteStage: "EX",
    branchResolveStage: "EX",
    sameCycleWbToOfVisible: false,
  },
  branches: { speculativeSequentialFetch: true, prediction: "none" },
  memory: { addressBits: 16, endianness: "big" },
  subtractionCarryConvention: "borrow-means-C1",
  branchBase: "instruction-address",
  maxCycles: 5000,
};
