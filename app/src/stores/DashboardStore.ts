import { observable, action, runInAction, transaction, IReactionDisposer, reaction } from 'mobx';
import { Option, None, Some } from 'funfix-core';
import { withRequest } from '@vzh/mobx-stores';
import { ServerStructure, localStorage, Query } from 'services';
import { TabModel, TreeFilter, MIN_SEARCH_LENGTH } from 'models';
import RootStore from './RootStore';
import ApiRequestableStore from './ApiRequestableStore';
import DashboardUIStore from './DashboardUIStore';
import ServerStructureFilter, { FilterResult } from './ServerStructureFilter';

export default class DashboardStore extends ApiRequestableStore<DashboardUIStore> {
  @observable
  serverStructure: Option<ServerStructure.Server> = None;

  @observable
  filteredItems: FilterResult = [];

  @observable
  tabs: ReadonlyArray<TabModel> = [
    TabModel.from({
      title: 'SQL 1',
      content: `
SELECT toInt64(9007199254740900+number) as bkig FROM  numbers(4) ORDER BY number DESC 
;;
SELECT 
toFloat32(sin(rand())) as xF32,
toFloat64(sin(rand())) as xF64,
now(),
toInt64(9007199254740982+number) as gran,
toInt64(11117311154531369000+number) as singun,
toUInt64(11117311154531369000+number) as nunun,
toInt16(now()+number) as xInt16,
toInt32(now()+number) as xInt32,
toInt64(now()+number) as xInt64
FROM  numbers(10) ORDER BY number DESC
;;
select * from cities
;;
SELECT * FROM system.tables FORMAT TSV
;;
SELECT 33 FORMAT JSON 
;;
SELECT 44 
;;
SELECT 55
;;
select number,sin(number) as sin,cos(number) as cos FROM  numbers(123) ORDER BY number DESC
;;
SELECT * FROM system.tables

`,
      currentDatabase: 'default',
    }),
    TabModel.from({
      title: 'SQL 2',
      content: `CREATE TABLE data (ts DATETIME,id VARCHAR,version UInt64, v0 Nullable(DOUBLE), v1 Nullable(DOUBLE)) ENGINE=Null
CREATE MATERIALIZED VIEW dataAgg ENGINE=AggregatingMergeTree PARTITION BY toStartOfDay(ts) ORDER BY (ts,id) AS SELECT ts, id, maxState(version) as version, anyLastState(v0) as v0, anyLastState(v1) as v1 FROM (select * from data order by version) GROUP BY ts,id;

insert into data values(toDateTime('2018-10-11 08:00:00'),'id1',0,0.0,null);
insert into data values(toDateTime('2018-10-11 08:00:00'), 'id1',3,3.0,3.0);
insert into data values(toDateTime('2018-10-11 08:00:00'),'id1',1,1.0,1.0);
insert into data values(toDateTime('2018-10-11 08:00:00'),'id1',2,2.0,2.0);

select ts,id,maxMerge(version),anyLastMerge(v0),anyLastMerge(v1) from (select * from dataAgg order by version) group by ts,id;
;;

SELECT 323;;73709551615, 0xDEADBEEF, 01, 0.1, 1e100, -1e-100, inf, nan
;;
SELECT arrayFilter(x -> x LIKE '%World%', ['Hello', 'abc World']) AS res
;;
SELECT field2 , sin(number) as sin  FROM system.numbers
sin( cos(DepTimeBlk) ) , bar(123)  -- support.function 
var1 , var2 , var3          -- markup.heading
 OriginWac,DepTimeBlk,DepTime,OriginAirportSeqID      -- variable.parameter
true|false|NULL    -- const
system.numbers_mt | system.numbers -- tables
ReplicatedCollapsingMergeTree -- dataTypes
SYSTEM RELOAD CONFIG -- doubleSysWord

CREATE TABLE IF NOT EXISTS all_hits ON CLUSTER cluster (p Date, i Int32) ENGINE = Distributed(cluster, default, hits)
DROP DATABASE IF EXISTS db ON CLUSTER cluster
SHOW TEMPORARY TABLES FROM default LIKE 'pattern' INTO OUTFILE filename FORMAT JSON
SELECT s, arr, a FROM arrays_test ARRAY JOIN arr AS a
;;
SELECT
    domainWithoutWWW(URL) AS domain,
    domainWithoutWWW(REFERRER_URL) AS referrer,
    device_type,
    count() cnt
FROM hits
GROUP BY domain, referrer, device_type
ORDER BY cnt DESC
LIMIT 5 BY domain, device_type
LIMIT 100
;;
 1, 18446744073709551615, 0xDEADBEEF, 01, 0.1, 1e100, -1e-100, inf, nan
;;
1 + 2 * 3 + 4
;;
SELECT arrayFilter(x -> x LIKE '%World%', ['Hello', 'abc World']) AS res
;;SELECT 1 as ping;;SELECT 2 as ping;;
SELECT 3
;; 
SELECT * from default.arrays_test_ints`,
      currentDatabase: 'default',
    }),
  ];

  @observable
  activeTab: Option<TabModel> = None;

  protected changeTabsReaction?: IReactionDisposer;

  protected changeActiveTabReaction?: IReactionDisposer;

  constructor(rootStore: RootStore, uiStore: DashboardUIStore) {
    super(rootStore, uiStore);

    this.startReactions();
  }

  private startReactions() {
    window.setInterval(() => {
      localStorage.saveTabs(this.tabs);
    }, 30000);

    this.changeTabsReaction = reaction(
      () => this.tabs,
      tabs => {
        localStorage.saveTabs(tabs);
      }
    );

    this.changeActiveTabReaction = reaction(
      () => this.activeTab,
      tab => {
        localStorage.saveActiveTabId(tab.map(t => t.id).orUndefined());
      }
    );
  }

  @withRequest
  async loadData() {
    const structure = await this.api.loadDatabaseStructure();

    transaction(() => {
      runInAction(() => {
        this.serverStructure = Option.of(structure);

        // load saved tabs
        localStorage.getTabs().forEach(tabs => {
          this.tabs = tabs.map(TabModel.from);
        });

        // load saved active tab id
        this.activeTab = localStorage
          .getActiveTabId()
          .flatMap(id => Option.of(this.tabs.find(t => t.id === id)))
          .orElseL(() => Option.of(this.tabs.length ? this.tabs[0] : undefined));
      });

      // expand root node if expanded keys is empty
      if (this.serverStructure.nonEmpty() && !this.uiStore.treeExpandedKeys.length) {
        this.uiStore.updateTreeExpandedKeys(this.serverStructure.map(ss => [ss.id]).get());
      }

      if (!this.tabs.length) {
        this.addNewTab();
      }
    });
  }

  @action.bound
  async filterServerStructure(filter: TreeFilter) {
    if (filter.search.length < MIN_SEARCH_LENGTH) {
      this.filteredItems = [];
      return;
    }

    const filtered = await ServerStructureFilter.from(filter).exec(this.serverStructure);
    runInAction(() => {
      this.filteredItems = filtered;
    });
  }

  @action
  setActiveTab(id: string) {
    this.activeTab = Option.of(this.tabs.find(_ => _.id === id));
  }

  // todo: fix if name already exists
  private getNewTabName = () => `SQL ${this.tabs.length + 1}`;

  @action
  addNewTab() {
    const newTab = TabModel.from({
      title: this.getNewTabName(),
      currentDatabase: this.activeTab
        .flatMap(t => t.currentDatabase)
        .orElse(this.serverStructure.map(s => s.databases[0]).map(d => d.name))
        .orUndefined(),
    });
    this.tabs = this.tabs.concat(newTab);
    this.activeTab = Some(newTab);
  }

  @action.bound
  removeTab(id: string) {
    this.tabs = this.tabs.filter(t => t.id !== id);
    this.activeTab = Option.of(this.tabs[this.tabs.length - 1]);
  }

  @withRequest.bound
  async saveEditedTab() {
    this.uiStore.editedTab.forEach(tab => {
      tab.submit();
      localStorage.saveTab(tab.model);
      this.uiStore.hideSaveModal();
    });
  }

  execQueries(queries: Query[]) {
    // if (this.activeTab.isEmpty() || this.activeTab.get().currentDatabase.isEmpty()) return; // ??
    if (!queries.length) return;

    const extendSettings = {
      max_execution_time: 20, // ToDo:Read from Store.User.Tabix.Settings
      max_result_rows: 50000, // ToDo:Read from Store.User.Tabix.Settings
    };

    this.activeTab.forEach(async tab => {
      const t = await this.request(async () =>
        // return api.fetch(tab.content, tab.currentDatabase.get());
        Promise.all(
          queries.map(q => {
            q.extendSettings = extendSettings;
            return this.api.fetch(q);
          })
        )
      );

      runInAction(() => {
        t.forEach(result => {
          // tab.data = Option.of(result);
          tab.data = result;
        });
      });
    });
  }
}
