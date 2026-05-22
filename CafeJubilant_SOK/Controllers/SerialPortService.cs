using System.IO.Ports;
using System.Text;

namespace CafeJubilant_SOK.Services
{
    public interface ISerialPortService
    {
        Task<string> SendCommandAsync(string command);
        Task<byte[]> SendCommandBytesAsync(byte[] command);
        Task<byte[]> SendCommandBytesAsync(byte[] command, int timeoutMs);
        bool IsConnected { get; }
        Task<bool> TryConnectAsync();
        Task<bool> TryConnectAsync(int baudRate);
        Task DisconnectAsync();
        string GetConnectionStatus();
    }

    public class SerialPortService : ISerialPortService, IDisposable
    {
        private SerialPort? _serialPort;
        private readonly ILogger<SerialPortService> _logger;
        private readonly SemaphoreSlim _semaphore = new(1, 1);
        private readonly string _comPort;
        private readonly int _baudRate;
        private int _currentBaudRate;
        private string _lastError = string.Empty;

        public bool IsConnected => _serialPort?.IsOpen ?? false;

        public SerialPortService(ILogger<SerialPortService> logger, IConfiguration configuration)
        {
            _logger = logger;
            _comPort = configuration["PaymentSettings:COM_PORT"] ?? "COM5";
            _baudRate = int.Parse(configuration["PaymentSettings:BAUDRATE"] ?? "9600");
            _currentBaudRate = _baudRate;

            _logger.LogInformation($"🔧 SerialPortService initialized for {_comPort} at {_baudRate} baud");
            _logger.LogInformation($"📋 Available COM ports: {string.Join(", ", SerialPort.GetPortNames())}");
        }

        public string GetConnectionStatus()
        {
            if (IsConnected)
                return $"Connected to {_comPort} at {_currentBaudRate} baud";

            if (!string.IsNullOrEmpty(_lastError))
                return $"Disconnected: {_lastError}";

            return $"Not connected to {_comPort}";
        }

        public async Task<bool> TryConnectAsync()
        {
            await _semaphore.WaitAsync();
            try
            {
                if (_serialPort?.IsOpen == true)
                {
                    _logger.LogInformation("✅ Already connected");
                    return true;
                }

                return await ConnectInternalAsync();
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public async Task<bool> TryConnectAsync(int baudRate)
        {
            await _semaphore.WaitAsync();
            try
            {
                _currentBaudRate = baudRate;

                if (_serialPort?.IsOpen == true)
                {
                    try
                    {
                        _serialPort.Close();
                        _logger.LogInformation($"🔌 Closed existing connection");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Warning closing existing connection");
                    }
                }

                await Task.Delay(500);
                return await ConnectInternalAsync();
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public async Task DisconnectAsync()
        {
            await _semaphore.WaitAsync();
            try
            {
                if (_serialPort?.IsOpen == true)
                {
                    _serialPort.Close();
                    _logger.LogInformation("🔌 Serial port disconnected");
                }

                if (_serialPort != null)
                {
                    _serialPort.Dispose();
                    _serialPort = null;
                }

                _lastError = string.Empty;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error disconnecting serial port");
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public async Task<byte[]> SendCommandBytesAsync(byte[] command)
        {
            return await SendCommandBytesAsync(command, 30000);
        }

        public async Task<byte[]> SendCommandBytesAsync(byte[] command, int timeoutMs)
        {
            await _semaphore.WaitAsync();
            try
            {
                // Ensure connection before sending
                await EnsureConnectedAsync();

                if (_serialPort == null || !_serialPort.IsOpen)
                {
                    throw new InvalidOperationException("Connection not up: Serial port is not open");
                }

                _logger.LogInformation("📤 Sending binary command ({Length} bytes)", command.Length);
                _logger.LogDebug("📤 Command HEX: {Hex}", BitConverter.ToString(command).Replace("-", ""));

                // Clear any existing data in buffer
                if (_serialPort.BytesToRead > 0)
                {
                    var discarded = _serialPort.BytesToRead;
                    _serialPort.DiscardInBuffer();
                    _logger.LogWarning("⚠️ Discarded {Count} bytes from input buffer", discarded);
                }
                _serialPort.DiscardOutBuffer();

                // Send command
                await _serialPort.BaseStream.WriteAsync(command, 0, command.Length);
                await _serialPort.BaseStream.FlushAsync();

                _logger.LogInformation("✅ Binary command sent, waiting for response...");

                // Read response
                var response = new List<byte>();
                var buffer = new byte[1024];
                var startTime = DateTime.Now;
                var timeout = TimeSpan.FromMilliseconds(timeoutMs);
                var lastLogTime = DateTime.Now;

                while ((DateTime.Now - startTime) < timeout)
                {
                    // Log progress every 5 seconds for long timeouts
                    if (timeoutMs > 10000 && (DateTime.Now - lastLogTime).TotalSeconds >= 5 && _serialPort.BytesToRead == 0)
                    {
                        _logger.LogWarning("⏱️ Still waiting for response... ({Elapsed}s elapsed, {Bytes} bytes received)",
                            (int)(DateTime.Now - startTime).TotalSeconds, response.Count);
                        lastLogTime = DateTime.Now;
                    }

                    if (_serialPort.BytesToRead > 0)
                    {
                        var available = _serialPort.BytesToRead;
                        var bytesRead = await _serialPort.BaseStream.ReadAsync(buffer, 0,
                            Math.Min(buffer.Length, available));

                        if (bytesRead > 0)
                        {
                            for (int i = 0; i < bytesRead; i++)
                            {
                                response.Add(buffer[i]);
                            }

                            _logger.LogDebug("📥 Received {Count} bytes (total: {Total})",
                                bytesRead, response.Count);

                            // Check for complete message (STX ... ETX LRC)
                            if (response.Count >= 5 && response[0] == 0x02)
                            {
                                // Get message length from bytes 1-2
                                var messageLength = (response[1] << 8) | response[2];
                                var expectedTotalLength = 3 + messageLength + 1 + 1; // STX + Length + Body + ETX + LRC

                                if (response.Count >= expectedTotalLength)
                                {
                                    // Verify ETX at correct position
                                    var etxPosition = 3 + messageLength;
                                    if (response[etxPosition] == 0x03)
                                    {
                                        _logger.LogInformation("✅ Complete response received ({Length} bytes)",
                                            response.Count);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    await Task.Delay(100);
                }

                if (response.Count == 0)
                {
                    _logger.LogError("❌ No response received from terminal after {Timeout}ms timeout", timeoutMs);
                    throw new TimeoutException("No response received from payment terminal");
                }

                var result = response.ToArray();
                _logger.LogInformation("✅ Response complete: {Length} bytes", result.Length);
                _logger.LogDebug("📥 Response HEX: {Hex}", BitConverter.ToString(result).Replace("-", ""));

                return result;
            }
            catch (TimeoutException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error communicating with terminal");

                if (_serialPort?.IsOpen == true)
                {
                    try { _serialPort.Close(); } catch { }
                }

                throw new InvalidOperationException($"Communication error: {ex.Message}", ex);
            }
            finally
            {
                _semaphore.Release();
            }
        }

        private async Task<bool> ConnectInternalAsync()
        {
            try
            {
                _logger.LogInformation($"🔌 Attempting to open serial port {_comPort}...");

                // List available ports for diagnostics
                var availablePorts = SerialPort.GetPortNames();
                _logger.LogInformation($"📋 Available ports: {(availablePorts.Length > 0 ? string.Join(", ", availablePorts) : "NONE")}");

                // Check if requested port exists
                if (!availablePorts.Contains(_comPort))
                {
                    _lastError = $"Port {_comPort} not found. Available: {string.Join(", ", availablePorts)}";
                    _logger.LogWarning($"⚠️ {_lastError}");
                    return false;
                }

                // Dispose old port if exists
                if (_serialPort != null)
                {
                    try
                    {
                        if (_serialPort.IsOpen)
                            _serialPort.Close();
                        _serialPort.Dispose();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Warning while disposing old serial port");
                    }
                }

                // Create new port
                _serialPort = new SerialPort(_comPort, _currentBaudRate)
                {
                    Parity = Parity.None,
                    DataBits = 8,
                    StopBits = StopBits.One,
                    Handshake = Handshake.None,
                    DtrEnable = true,
                    RtsEnable = true,
                    ReadTimeout = 30000,
                    WriteTimeout = 5000
                };

                // Open the port
                _serialPort.Open();
                _lastError = string.Empty;

                _logger.LogInformation($"✅ Serial port {_comPort} opened successfully at {_currentBaudRate} baud");

                // Small delay to let port stabilize
                await Task.Delay(100);

                return true;
            }
            catch (UnauthorizedAccessException ex)
            {
                _lastError = $"Access denied - port may be in use by another application";
                _logger.LogError(ex, $"❌ {_lastError}");
                return false;
            }
            catch (IOException ex)
            {
                _lastError = $"I/O error - port may not exist or device not connected";
                _logger.LogError(ex, $"❌ {_lastError}");
                return false;
            }
            catch (ArgumentException ex)
            {
                _lastError = $"Invalid port configuration";
                _logger.LogError(ex, $"❌ {_lastError}");
                return false;
            }
            catch (Exception ex)
            {
                _lastError = $"Unexpected error: {ex.Message}";
                _logger.LogError(ex, $"❌ Failed to open serial port {_comPort}");
                return false;
            }
        }

        private async Task EnsureConnectedAsync()
        {
            if (_serialPort?.IsOpen == true)
                return;

            _logger.LogWarning($"⚠️ Serial port not connected, attempting to connect...");

            var connected = await ConnectInternalAsync();

            if (!connected)
            {
                throw new InvalidOperationException($"Connection not up: {_lastError}");
            }
        }

        public async Task<string> SendCommandAsync(string command)
        {
            await _semaphore.WaitAsync();
            try
            {
                // Ensure connection before sending
                await EnsureConnectedAsync();

                if (_serialPort == null || !_serialPort.IsOpen)
                {
                    throw new InvalidOperationException("Connection not up: Serial port is not open");
                }

                _logger.LogInformation($"📤 Sending command: {command.Replace("\r\n", "\\r\\n")}");

                // Clear any existing data
                _serialPort.DiscardInBuffer();
                _serialPort.DiscardOutBuffer();

                // Send command
                var bytes = Encoding.ASCII.GetBytes(command);
                await _serialPort.BaseStream.WriteAsync(bytes, 0, bytes.Length);
                await _serialPort.BaseStream.FlushAsync();

                // Wait for response
                var response = new StringBuilder();
                var buffer = new byte[1024];
                var startTime = DateTime.Now;
                var timeout = TimeSpan.FromSeconds(30);

                while ((DateTime.Now - startTime) < timeout)
                {
                    if (_serialPort.BytesToRead > 0)
                    {
                        var bytesRead = await _serialPort.BaseStream.ReadAsync(buffer, 0, buffer.Length);
                        response.Append(Encoding.ASCII.GetString(buffer, 0, bytesRead));

                        // Check if we have a complete response
                        var responseStr = response.ToString();
                        if (responseStr.Contains("\r\n") ||
                            responseStr.Contains("APPROVED") ||
                            responseStr.Contains("DECLINED") ||
                            responseStr.Contains("ERROR"))
                        {
                            break;
                        }
                    }
                    await Task.Delay(100);
                }

                var result = response.ToString();

                if (string.IsNullOrEmpty(result))
                {
                    _logger.LogWarning("⚠️ No response received from terminal (timeout)");
                    throw new TimeoutException("No response received from payment terminal");
                }

                _logger.LogInformation($"📥 Received response: {result.Replace("\r\n", "\\r\\n")}");

                return result;
            }
            catch (InvalidOperationException)
            {
                // Re-throw connection errors with clear message
                throw;
            }
            catch (TimeoutException)
            {
                // Re-throw timeout errors
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error communicating with terminal");

                // Try to reconnect on next attempt
                if (_serialPort?.IsOpen == true)
                {
                    try
                    {
                        _serialPort.Close();
                    }
                    catch { }
                }

                throw new InvalidOperationException($"Communication error: {ex.Message}", ex);
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public void Dispose()
        {
            try
            {
                if (_serialPort?.IsOpen == true)
                {
                    _serialPort.Close();
                    _logger.LogInformation("🔌 Serial port closed");
                }
                _serialPort?.Dispose();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Warning while disposing serial port");
            }
            finally
            {
                _semaphore?.Dispose();
            }
        }
    }
}