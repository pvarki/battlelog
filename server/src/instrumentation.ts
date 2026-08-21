if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const [
    { diag, DiagConsoleLogger, DiagLogLevel },
    { getNodeAutoInstrumentations },
    { OTLPMetricExporter },
    { OTLPTraceExporter },
    { PeriodicExportingMetricReader },
    { NodeSDK },
  ] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/auto-instrumentations-node"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/sdk-node"),
  ]);

  // OTel's default diag logger is a no-op — without this, exporter failures
  // (unreachable OTLP endpoint) drop telemetry with no indication anywhere.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}
