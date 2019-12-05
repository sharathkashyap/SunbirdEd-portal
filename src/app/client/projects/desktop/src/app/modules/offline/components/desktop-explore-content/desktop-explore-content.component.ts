import {
    ResourceService, ConfigService, ToasterService, INoResultMessage,
    ILoaderMessage, UtilService, PaginationService
} from '@sunbird/shared';
import { SearchService, OrgDetailsService, FrameworkService } from '@sunbird/core';
import { combineLatest, Subject } from 'rxjs';
import { Component, OnInit, OnDestroy, EventEmitter } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import * as _ from 'lodash-es';
import { PublicPlayerService } from '@sunbird/public';
import { Location } from '@angular/common';
import { takeUntil, map, mergeMap, first, filter, debounceTime, tap, delay } from 'rxjs/operators';
import { IPagination } from '@sunbird/announcement';
import { ConnectionService } from '../../services';


@Component({
    selector: 'app-desktop-explore-content',
    templateUrl: './desktop-explore-content.component.html',
    styleUrls: ['./desktop-explore-content.component.scss']
})
export class DesktopExploreContentComponent implements OnInit, OnDestroy {

    public showLoader = true;
    public baseUrl: string;
    public noResultMessage: INoResultMessage;
    public filterType: string;
    public queryParams: any;
    public unsubscribe$ = new Subject<void>();
    public initFilters = false;
    public loaderMessage: ILoaderMessage;
    public showFilters = false;
    public sections: any[] = [];
    public hashTagId: string;
    public dataDrivenFilterEvent = new EventEmitter();
    public dataDrivenFilters: any = {};
    public facets: string[];
    public contentList = [];
    public isViewAll = false;

    public paginationDetails: IPagination;
    public isConnected = navigator.onLine;

    constructor(
        public router: Router,
        public searchService: SearchService,
        public activatedRoute: ActivatedRoute,
        public resourceService: ResourceService,
        public toasterService: ToasterService,
        public configService: ConfigService,
        public utilService: UtilService,
        private publicPlayerService: PublicPlayerService,
        public location: Location,
        public orgDetailsService: OrgDetailsService,
        public frameworkService: FrameworkService,
        public paginationService: PaginationService,
        private connectionService: ConnectionService
    ) {
        this.filterType = this.configService.appConfig.explore.filterType;
    }

    ngOnInit() {
        this.connectionService.monitor().subscribe(isConnected => {
            this.isConnected = isConnected;
        });

        if (_.includes(this.router.url, 'view-all')) {
            this.isViewAll = true;
            this.fetchRecentlyAddedContent();
        } else {
            this.paginationDetails = this.paginationService.getPager(0, 1, this.configService.appConfig.SEARCH.PAGE_LIMIT);
            this.isViewAll = false;
            this.orgDetailsService.getOrgDetails(this.activatedRoute.snapshot.params.slug).subscribe((orgDetails: any) => {
                this.hashTagId = orgDetails.hashTagId;
                this.initFilters = true;
            }, error => {
                this.router.navigate(['']);
            });
        }
    }

    fetchRecentlyAddedContent() {
        const softConstraintData: any = {
            filters: {
                channel: this.activatedRoute.snapshot.queryParams.channel,
                contentType: ['Collection', 'TextBook', 'LessonPlan', 'Resource']
            },
            softConstraints: _.get(this.activatedRoute.snapshot, 'data.softConstraints'),
            mode: 'soft'
        };

        const facets = ['board', 'medium', 'gradeLevel', 'subject'];

        const option = {
            filters: softConstraintData.filters,
            mode: _.get(softConstraintData, 'mode'),
            facets: facets,
            params: this.configService.appConfig.ExplorePage.contentApiQueryParams,
            softConstraints: softConstraintData.softConstraints
        };

        this.searchService.contentSearch(option)
            .subscribe(response => {
                this.showLoader = false;
                const orderedContents = _.orderBy(_.get(response, 'result.content'), ['desktopAppMetadata.updatedOn'], ['desc']);
                this.contentList = this.formatSearchResults(orderedContents);
            }, error => {
                this.setNoResultMessage();
            });
    }

    public getFilters(filters) {
        this.facets = filters.map(element => element.code);
        this.dataDrivenFilters = filters;
        this.fetchContentOnParamChange();
        this.setNoResultMessage();
    }

    onFilterChange(event) {
        this.showLoader = true;
        this.dataDrivenFilters = _.cloneDeep(event.filters);
        this.fetchContents();
        this.publicPlayerService.libraryFilters = event.filters;
    }

    private fetchContentOnParamChange() {
        combineLatest(this.activatedRoute.params, this.activatedRoute.queryParams)
            .pipe(debounceTime(5),
                delay(10),
                map(result => ({ params: { pageNumber: Number(result[0].pageNumber) }, queryParams: result[1] })),
                takeUntil(this.unsubscribe$)
            ).subscribe(({ params, queryParams }) => {
                this.showLoader = true;
                this.paginationDetails.currentPage = params.pageNumber;
                this.queryParams = { ...queryParams };
                this.fetchContents();
            });
    }

    private fetchContents() {
        this.constructSearchRequest();
        this.searchService.contentSearch(this.constructSearchRequest())
            .subscribe(data => {
                this.showLoader = false;
                this.paginationDetails = this.paginationService.getPager(data.result.count, this.paginationDetails.currentPage,
                    this.configService.appConfig.SEARCH.PAGE_LIMIT);
                const { constantData, metaData, dynamicFields } = this.configService.appConfig.LibrarySearch;
                this.contentList = this.utilService.getDataForCard(data.result.content, constantData, dynamicFields, metaData);
                console.log('contentList', this.contentList);
            }, err => {
                this.showLoader = false;
                this.contentList = [];
                this.paginationDetails = this.paginationService.getPager(0, this.paginationDetails.currentPage,
                    this.configService.appConfig.SEARCH.PAGE_LIMIT);
                this.toasterService.error(this.resourceService.messages.fmsg.m0051);
            });
    }

    constructSearchRequest() {
        let filters = _.pickBy(this.dataDrivenFilters, (value: Array<string> | string) => value && value.length);
        filters = _.omit(filters, ['key', 'sort_by', 'sortType', 'appliedFilters']);
        const softConstraintData: any = {
            filters: {
                channel: this.hashTagId
            },
            softConstraints: _.get(this.activatedRoute.snapshot, 'data.softConstraints'),
            mode: 'soft'
        };
        if (this.dataDrivenFilters.board) {
            softConstraintData.board = this.dataDrivenFilters.board;
        }
        const manipulatedData = this.utilService.manipulateSoftConstraint(_.get(this.dataDrivenFilters, 'appliedFilters'),
            softConstraintData);
        const option: any = {
            filters: _.get(this.dataDrivenFilters, 'appliedFilters') ? filters : manipulatedData.filters,
            mode: _.get(manipulatedData, 'mode'),
            params: this.configService.appConfig.ExplorePage.contentApiQueryParams,
            query: this.queryParams.key,
            facets: this.facets,
        };

        if (_.includes(this.router.url, 'browse')) {
            option.limit = this.configService.appConfig.SEARCH.PAGE_LIMIT;
            option.pageNumber = _.get(this.paginationDetails, 'currentPage');
        }

        option.filters['contentType'] = filters.contentType || ['Collection', 'TextBook', 'LessonPlan', 'Resource'];
        if (manipulatedData.filters) {
            option['softConstraints'] = _.get(manipulatedData, 'softConstraints');
        }

        this.frameworkService.channelData$.subscribe((channelData) => {
            if (!channelData.err) {
                option.params.framework = _.get(channelData, 'channelData.defaultFramework');
            }
        });
        console.log('option', option);

        return option;
    }

    private formatSearchResults(list) {
        _.forEach(list, (value, index) => {
            const constantData = this.configService.appConfig.ViewAll.otherCourses.constantData;
            const metaData = this.configService.appConfig.ViewAll.metaData;
            const dynamicFields = this.configService.appConfig.ViewAll.dynamicFields;
            list[index] = this.utilService.processContent(list[index],
                constantData, dynamicFields, metaData);
        });
        return list;
    }

    public navigateToPage(page: number): void {
        if (page < 1 || page > this.paginationDetails.totalPages) {
            return;
        }
        const url = this.router.url.split('?')[0].replace(/[^\/]+$/, page.toString());
        this.router.navigate([url], { queryParams: this.queryParams });
        window.scroll({
            top: 0,
            left: 0,
            behavior: 'smooth'
        });
    }

    goBack() {
        this.location.back();
    }

    public playContent(event) {
        if (_.includes(this.router.url, 'browse')) {
            this.publicPlayerService.playContentForOfflineBrowse(event);
        } else {
            this.publicPlayerService.playContent(event);
        }
    }

    ngOnDestroy() {
        this.unsubscribe$.next();
        this.unsubscribe$.complete();
    }

    private setNoResultMessage() {
        if (!(this.router.url.includes('/browse'))) {
            this.noResultMessage = {
                'message': 'messages.stmsg.m0007',
                'messageText': 'messages.stmsg.m0133'
            };
        } else {
            this.noResultMessage = {
                'message': 'messages.stmsg.m0007',
                'messageText': 'messages.stmsg.m0006'
            };
        }
    }
}
