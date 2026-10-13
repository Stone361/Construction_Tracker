package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseListRow;
import com.example.constructiontracker.domain.HouseSourceType;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.dto.AdvanceHouseRequest;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.dto.HouseDetailResponse;
import com.example.constructiontracker.dto.HouseListQuery;
import com.example.constructiontracker.dto.HouseResponse;
import com.example.constructiontracker.dto.PhotoResponse;
import com.example.constructiontracker.dto.SetCoverRequest;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.mapper.PhotoMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Service
@Validated
public class HouseService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("America/Chicago");
    private final HouseMapper mapper;
    private final PhotoMapper photos;
    private final AuthorizationService authorization;
    private final Clock clock;

    public HouseService(HouseMapper mapper, PhotoMapper photos, AuthorizationService authorization, Clock clock) {
        this.mapper = mapper;
        this.photos = photos;
        this.authorization = authorization;
        this.clock = clock;
    }

    /** 所有已认证角色可读全部社区；SQL 完成过滤和排序，不按房屋逐条查询。 */
    public List<House> list(@NotNull HouseListQuery query) {
        return mapper.findAll(query).stream().map(HouseListRow::house).toList();
    }

    /** 房屋及照片业务日由同一次 SQL 读取，生成 URL 不查询文件或逐栋查询照片。 */
    public List<HouseResponse> listResponses(@NotNull HouseListQuery query) {
        return mapper.findAll(query).stream().map(HouseResponse::from).toList();
    }

    public HouseDetailResponse setCover(Long id, @NotNull @Valid SetCoverRequest request, UserIdentity identity) {
        if (id == null || id <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "房屋 ID 必须为正整数");
        }
        House house = mapper.findById(id);
        if (house == null) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "NOT_FOUND", "房屋不存在");
        }
        authorization.requireCanManageHouse(identity, house.community());
        if (photos.findFile(id, request.photoId()) == null) {
            throw new BusinessException(HttpStatus.UNPROCESSABLE_ENTITY, "BUSINESS_RULE_VIOLATION",
                    "照片不存在或不属于该房屋");
        }
        LocalDateTime utc = LocalDateTime.ofInstant(clock.instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC);
        // 同一封面重复设置可能没有实际字段变化，不能把影响行数为 0 误判为归属失败。
        mapper.updateCover(id, request.photoId(), utc);
        return detail(id);
    }

    /** 阶段条件更新与审计 INSERT 共用事务；并发失败者不写入审计。 */
    @Transactional
    public HouseDetailResponse advance(Long id, @NotNull @Valid AdvanceHouseRequest request, UserIdentity identity) {
        if (id == null || id <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "房屋 ID 必须为正整数");
        }
        House house = mapper.findById(id);
        if (house == null) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "NOT_FOUND", "房屋不存在");
        }
        authorization.requireCanManageHouse(identity, house.community());
        if (identity.username() == null || identity.username().isBlank() || identity.username().length() > 128) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "用户名必须为1到128个字符");
        }
        if (house.stage() != request.fromStage()) {
            throw new BusinessException(HttpStatus.CONFLICT, "CONFLICT", "当前施工阶段已变化，请刷新后重试");
        }
        ConstructionStage next = switch (request.fromStage()) {
            case LAND_CLEARING -> ConstructionStage.FOUNDATION;
            case FOUNDATION -> ConstructionStage.FRAMING;
            case FRAMING -> ConstructionStage.MEP;
            case MEP -> ConstructionStage.INTERIOR;
            case INTERIOR -> ConstructionStage.CO_READY;
            case CO_READY -> null;
        };
        if (next == null || request.toStage() != next) {
            throw new BusinessException(HttpStatus.UNPROCESSABLE_ENTITY, "BUSINESS_RULE_VIOLATION",
                    "施工阶段只能向前推进一级");
        }
        if (!photos.hasEligiblePhoto(id, request.fromStage())) {
            throw new BusinessException(HttpStatus.UNPROCESSABLE_ENTITY, "BUSINESS_RULE_VIOLATION",
                    "当前施工阶段缺少非 SUSPECT 的照片");
        }
        LocalDateTime utc = LocalDateTime.ofInstant(clock.instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC);
        if (mapper.advanceStage(id, request.fromStage(), request.toStage(), utc) != 1) {
            throw new BusinessException(HttpStatus.CONFLICT, "CONFLICT", "当前施工阶段已变化，请刷新后重试");
        }
        if (mapper.insertStageHistory(id, request.fromStage(), request.toStage(), identity.username(), utc) != 1) {
            throw new IllegalStateException("Stage history was not inserted");
        }
        return detail(id);
    }

    /** 固定两次读取，全部角色可跨社区查看；照片排序由 SQL 完成。 */
    public HouseDetailResponse detail(Long id) {
        if (id == null || id <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "房屋 ID 必须为正整数");
        }
        House house = mapper.findById(id);
        if (house == null) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "NOT_FOUND", "房屋不存在");
        }
        var photos = mapper.findPhotosByHouseId(id).stream().map(PhotoResponse::from).toList();
        return HouseDetailResponse.from(house, photos);
    }

    /**
     * 单次 INSERT 是唯一写入，按许可证唯一键处理并发；重复请求从不更新原记录。
     * 故意不包在 REPEATABLE READ 事务中，唯一键冲突后使用新的读快照读取已提交记录。
     */
    public CreationResult create(@NotNull @Valid CreateHouseRequest request, UserIdentity identity) {
        authorization.requireAdmin(identity);
        if (identity.username() == null || identity.username().isBlank() || identity.username().length() > 128) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "用户名必须为1到128个字符");
        }
        House existing = mapper.findByPermitNo(request.permitNo());
        if (existing != null) {
            return new CreationResult(existing, false);
        }

        Instant instant = clock.instant().truncatedTo(ChronoUnit.MICROS);
        LocalDateTime utc = LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
        House house = new House(null, request.permitNo(), request.address(), request.community(),
                request.lat(), request.lng(), ConstructionStage.LAND_CLEARING, null,
                request.sourceUrl() == null ? HouseSourceType.MANUAL : HouseSourceType.PUBLIC_DATA,
                request.sourceUrl(), request.sourceFetchedAt() == null ? null
                        : LocalDateTime.ofInstant(request.sourceFetchedAt().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC),
                utc, instant.atZone(BUSINESS_ZONE).toLocalDate(), identity.username(), utc);
        try {
            mapper.insert(house);
        } catch (DuplicateKeyException ex) {
            existing = mapper.findByPermitNo(request.permitNo());
            if (existing == null) {
                throw ex;
            }
            return new CreationResult(existing, false);
        }
        House saved = mapper.findByPermitNo(request.permitNo());
        if (saved == null) {
            throw new IllegalStateException("Inserted house could not be read back");
        }
        return new CreationResult(saved, true);
    }

    public record CreationResult(House house, boolean created) {
    }
}
