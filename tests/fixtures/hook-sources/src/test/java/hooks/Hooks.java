package hooks;

import io.cucumber.java.After;
import io.cucumber.java.Before;

public class Hooks {
    private DriverFactory factory;

    @Before
    public void launchBrowser() {
        String browserName = System.getProperty("browser", "chrome");
        page = factory.initDriver(browserName);
    }

    @After(order = 1)
    public void quitBrowser() {
        factory.getBrowser().close();
    }

    public void helper() {
        launchBrowser();
    }
}
