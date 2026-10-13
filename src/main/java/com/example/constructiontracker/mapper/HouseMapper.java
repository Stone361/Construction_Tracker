package com.example.constructiontracker.mapper;

import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseListRow;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.dto.HouseListQuery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface HouseMapper {
    House findByPermitNo(@Param("permitNo") String permitNo);

    House findById(@Param("id") Long id);

    List<PhotoMetadata> findPhotosByHouseId(@Param("houseId") Long houseId);

    List<HouseListRow> findAll(@Param("query") HouseListQuery query);

    int updateCover(@Param("id") Long id, @Param("photoId") Long photoId,
                    @Param("updatedAt") LocalDateTime updatedAt);

    int insert(@Param("house") House house);
}
