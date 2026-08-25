import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { readGrid, readGridRows, waitForGrid, chartExists, type GridState } from '../kendo/kendo';

/** Create and View Forecasts: a forecast grid plus a curve chart. */
export class ForecastPage extends BasePage {
  async open(): Promise<this> {
    await this.goto('forecast');
    return this;
  }

  get grid(): Locator {
    return this.page.locator('#cvf-grid');
  }

  get curveChart(): Locator {
    return this.page.locator('#cvf-chart');
  }

  get editorWindow(): Locator {
    return this.page.locator('#forecast-editor-window');
  }

  async state(): Promise<GridState> {
    await waitForGrid(this.page, 'cvf-grid');
    return readGrid(this.page, 'cvf-grid');
  }

  async rows<T = Record<string, unknown>>(limit = 100): Promise<T[]> {
    return readGridRows<T>(this.page, 'cvf-grid', limit);
  }

  async hasCurveChart(): Promise<boolean> {
    return chartExists(this.page, 'cvf-chart');
  }

  /** DESTRUCTIVE: the editor's save creates or updates a forecast. */
  get saveButton(): Locator {
    return this.page.locator('#forecast-edit-Ok, #forecast-editor-window .k-button-solid-primary').first();
  }
}

export class ForecastBlacklistsPage extends BasePage {
  async open(): Promise<this> {
    await this.goto('forecastBlacklists');
    return this;
  }
}

export class ForecastDiscountCurvesPage extends BasePage {
  async open(): Promise<this> {
    await this.goto('forecastDiscountCurves');
    return this;
  }
}
