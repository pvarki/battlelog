if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const [
    { getNodeAutoInstrumentations },
    { OTLPMetricExporter },
    { OTLPTraceExporter },
    { PeriodicExportingMetricReader },
    { NodeSDK },
  ] = await Promise.all([
    import("@opentelemetry/auto-instrumentations-node"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/sdk-node"),
  ]);

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}
