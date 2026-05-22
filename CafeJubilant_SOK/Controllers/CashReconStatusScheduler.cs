using Microsoft.AspNetCore.Mvc;

namespace CafeJubilant_SOK.Controllers
{
    public class CashReconStatusScheduler : BackgroundService
    {
        private readonly ILogger<CashReconStatusScheduler> _logger;
        private readonly IServiceProvider _serviceProvider;

        // ✅ 3 trigger times
        private readonly TimeSpan _firstRun = new TimeSpan(0, 0, 0);   // 00:00:00 midnight
        private readonly TimeSpan _secondRun = new TimeSpan(8, 0, 0);   // 08:00:00 AM

        public CashReconStatusScheduler(
            ILogger<CashReconStatusScheduler> logger,
            IServiceProvider serviceProvider)
        {
            _logger = logger;
            _serviceProvider = serviceProvider;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("CashReconStatusScheduler started");

            while (!stoppingToken.IsCancellationRequested)
            {
                var now = DateTime.Now;
                var nextRun = GetNextRunTime(now);
                var delay = nextRun - now;

                _logger.LogInformation("Next CashReconStatus check scheduled at: {NextRun}", nextRun);

                await Task.Delay(delay, stoppingToken);

                if (stoppingToken.IsCancellationRequested) break;

                await RunCheckAsync();
            }

            _logger.LogInformation("CashReconStatusScheduler stopped");
        }

        private DateTime GetNextRunTime(DateTime now)
        {
            var today = now.Date;

            var candidates = new[]
            {
                today.Add(_firstRun),
                today.Add(_secondRun),
                today.AddDays(1).Add(_firstRun),
                today.AddDays(1).Add(_secondRun)
            };

            return candidates
                .Where(t => t > now)
                .OrderBy(t => t)
                .First();
        }

        private async Task RunCheckAsync()
        {
            try
            {
                _logger.LogInformation("Scheduled CashReconStatus check started at: {Time}", DateTime.Now);

                using var scope = _serviceProvider.CreateScope();
                var controller = scope.ServiceProvider.GetRequiredService<KIOSKController>();

                var result = await controller.GetCashReconStatus();

                switch (result)
                {
                    case ContentResult content:
                        _logger.LogInformation("Scheduled CashReconStatus succeeded: {Content}", content.Content);
                        break;

                    case ObjectResult { StatusCode: >= 400 } objResult:
                        _logger.LogWarning("Scheduled CashReconStatus failed: {Value}", objResult.Value);
                        break;

                    default:
                        _logger.LogInformation("Scheduled CashReconStatus completed");
                        break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception in scheduled CashReconStatus check");
            }
        }
    }
}