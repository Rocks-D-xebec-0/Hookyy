package hooks;

public class DriverFactory {
    public Page initDriver(String browserName) {
        Browser browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true));
        return browser.newPage();
    }
}
